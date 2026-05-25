// FHE Event Listener Hook - WebSocket-like real-time updates
// Uses wagmi's watchContractEvent to listen for Transfer events

import { useEffect, useRef, useCallback } from 'react'
import { watchContractEvent, getPublicClient } from 'wagmi/actions'
import { ethers } from 'ethers'
import { CONTRACTS } from './contracts'
import { ABIS } from './abis'
import { config } from './wagmi'

const RPC_URL = 'https://atlantic.dplabs-internal.com'
const BLOCK_CHUNK_SIZE = 1000 // Pharos RPC limit

export type FheEvent = {
  type: 'transfer' | 'deposit' | 'withdraw'
  from: string
  to: string
  handle?: string
  txHash: string
  blockNumber: number
  timestamp: number
}

export type EventCallback = (event: FheEvent) => void

// Transfer event topic (computed from actual contract)
// Transfer(address,address,bytes32) → 0x8d61cf26ce654b1352bb60df9f3d4056b9e85a63977debf8fc9cd727aeda767e
const TRANSFER_EVENT_TOPIC = '0x8d61cf26ce654b1352bb60df9f3d4056b9e85a63977debf8fc9cd727aeda767e'

// Listen for FHE Transfer events for a specific user
export function useFheEventListener(
  userAddress: string | undefined,
  onEvent: EventCallback
) {
  const listenerRef = useRef<{ unwatch: () => void } | null>(null)
  const callbackRef = useRef(onEvent)

  // Keep callback ref updated
  useEffect(() => {
    callbackRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!userAddress) return

    const client = getPublicClient(config)

    // Watch for Transfer events
    const unwatch = watchContractEvent(config, {
      address: CONTRACTS.EUSDC as `0x${string}`,
      abi: ABIS.EUSDC,
      eventName: 'Transfer',
      onLogs: (logs) => {
        for (const log of logs) {
          const { topics, data, transactionHash, blockNumber } = log

          // Parse Transfer event
          // topics[0] = event signature
          // topics[1] = from address (indexed)
          // topics[2] = to address (indexed)
          // data = value handle (not indexed)

          if (topics.length >= 3) {
            const from = '0x' + topics[1].slice(26)
            const to = '0x' + topics[2].slice(26)

            // Check if this event involves our user
            if (from.toLowerCase() === userAddress.toLowerCase() ||
                to.toLowerCase() === userAddress.toLowerCase()) {

              const event: FheEvent = {
                type: 'transfer',
                from,
                to,
                handle: data as string,
                txHash: transactionHash,
                blockNumber: Number(blockNumber),
                timestamp: Date.now(),
              }

              callbackRef.current(event)
            }
          }
        }
      },
    })

    listenerRef.current = { unwatch }

    return () => {
      if (listenerRef.current) {
        listenerRef.current.unwatch()
        listenerRef.current = null
      }
    }
  }, [userAddress])

  return {
    isConnected: !!listenerRef.current,
  }
}

// Poll for handle updates (fallback when event listener not reliable)
export function useHandlePolling(
  userAddress: string | undefined,
  currentHandle: string | undefined,
  onHandleUpdate: (newHandle: string) => void,
  intervalMs: number = 2000 // Poll every 2s
) {
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const callbackRef = useRef(onHandleUpdate)
  const lastHandleRef = useRef<string | undefined>(currentHandle)

  useEffect(() => {
    callbackRef.current = onHandleUpdate
    lastHandleRef.current = currentHandle
  }, [onHandleUpdate, currentHandle])

  useEffect(() => {
    if (!userAddress) return

    const poll = async () => {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL)
        const contract = new ethers.Contract(CONTRACTS.EUSDC, ABIS.EUSDC, provider)
        const newHandle = await contract.balanceOf(userAddress)

        // Check if handle changed
        if (newHandle !== lastHandleRef.current) {
          lastHandleRef.current = newHandle
          callbackRef.current(newHandle)
        }
      } catch (e) {
        console.error('[handlePolling] Error:', e)
      }
    }

    pollingRef.current = setInterval(poll, intervalMs)
    poll() // Initial poll

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [userAddress, intervalMs])

  return {
    stopPolling: () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    },
    startPolling: () => {
      // Polling auto-starts on mount
    },
  }
}

// Combined hook: Event listener + Polling fallback
export function useRealtimeHandleUpdates(
  userAddress: string | undefined,
  currentHandle: string | undefined,
  onUpdate: (event: { handle: string, type: 'event' | 'poll', timestamp: number }) => void
) {
  const lastUpdateRef = useRef<number>(0)
  const callbackRef = useRef(onUpdate)

  useEffect(() => {
    callbackRef.current = onUpdate
  }, [onUpdate])

  // Event listener (primary)
  const handleEvent = useCallback((event: FheEvent) => {
    // Debounce: only process if > 1s since last update
    if (Date.now() - lastUpdateRef.current > 1000) {
      lastUpdateRef.current = Date.now()
      callbackRef.current({
        handle: event.handle || '',
        type: 'event',
        timestamp: event.timestamp,
      })
    }
  }, [])

  useFheEventListener(userAddress, handleEvent)

  // Polling (fallback, every 3s)
  const handlePollUpdate = useCallback((newHandle: string) => {
    // Debounce: only process if > 1s since last update
    if (Date.now() - lastUpdateRef.current > 1000) {
      lastUpdateRef.current = Date.now()
      callbackRef.current({
        handle: newHandle,
        type: 'poll',
        timestamp: Date.now(),
      })
    }
  }, [])

  useHandlePolling(userAddress, currentHandle, handlePollUpdate, 3000)
}