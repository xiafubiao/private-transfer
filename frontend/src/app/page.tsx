'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAccount, useChainId, useDisconnect, useConnect, useSwitchChain, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSignTypedData } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { defineChain } from 'viem'
import { ethers } from 'ethers'
import { CONTRACTS } from '../lib/contracts'
import { ABIS } from '../lib/abis'
import { initFhe, encryptAmount, decryptHandle, prepareDecryptPayload } from '../lib/fhe-browser'
import { ensureWalletConnected } from '../lib/wallet-signer'

const pharos = defineChain({
  id: 688689,
  name: 'Pharos Atlantic Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://atlantic.dplabs-internal.com'] },
  },
  blockExplorers: {
    default: { name: 'Pharos Explorer', url: 'https://atlantic.pharosscan.xyz/' },
  },
})

type Tab = 'deposit' | 'transfer' | 'withdraw'
type FheStatus = 'idle' | 'tx-confirming' | 'fhe-processing' | 'ready-to-decrypt' | 'decrypting' | 'complete' | 'error'

const FHE_PROCESSING_TIME = 5000 // 5 seconds - actual FHE processing is ~1-4s based on testing

export default function Home() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, isPending: switching } = useSwitchChain()
  const { writeContractAsync, isPending } = useWriteContract()
  const { signTypedDataAsync } = useSignTypedData()
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null)

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: pendingTxHash as `0x${string}`,
  })

  // FHE processing state
  const [fheStatus, setFheStatus] = useState<FheStatus>('idle')
  const [fheProgress, setFheProgress] = useState(0) // 0-100
  const [lastTxType, setLastTxType] = useState<Tab | null>(null)
  const fheTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [activeTab, setActiveTab] = useState<Tab>('deposit')
  const [previousTab, setPreviousTab] = useState<Tab>('deposit') // 记录操作前的 tab
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [statusStep, setStatusStep] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [isBalanceHidden, setIsBalanceHidden] = useState(false) // 余额隐藏状态
  const [decrypting, setDecrypting] = useState(false)
  const [showAuditor, setShowAuditor] = useState(false)
  const [whitelistAddr, setWhitelistAddr] = useState('')
  const [whitelist, setWhitelist] = useState<string[]>([])
  const [whitelistBalances, setWhitelistBalances] = useState<Record<string, string>>({})
  const [auditorError, setAuditorError] = useState<string | null>(null)
  const [allUsers, setAllUsers] = useState<{address: string, handle: string}[]>([])
  const [allUserBalances, setAllUserBalances] = useState<Record<string, string>>({})
  const [syncing, setSyncing] = useState(false)
  const [decryptingUser, setDecryptingUser] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null) // Toast提示消息
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authChecking, setAuthChecking] = useState(false)
  const [authResult, setAuthResult] = useState<'checking' | 'authorized' | 'denied' | null>(null)

  // 交易确认弹窗状态
  const [showTxModal, setShowTxModal] = useState(false)
  const [txModalPhase, setTxModalPhase] = useState<'confirming' | 'broadcasted' | 'completed'>('confirming')
  const [countdownSeconds, setCountdownSeconds] = useState(5)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)
  const [broadcastTxHash, setBroadcastTxHash] = useState<string | null>(null)  // 广播时的hash

  // 操作阶段状态：idle → encrypting → submitting → confirming
  const [operationPhase, setOperationPhase] = useState<'idle' | 'encrypting' | 'submitting' | 'confirming'>('idle')

  const BOB_ADDRESS = '0x6Dc43F7E4B0bDe827BC852Ae364aeF964e7D92cC'

  const isWrongChain = isConnected && chainId !== pharos.id

  // 显示Toast提示（2秒后自动消失）
  const showToast = useCallback((message: string) => {
    setToastMessage(message)
    setTimeout(() => setToastMessage(null), 2000)
  }, [])

  // 判断是否是用户主动拒绝
  const isUserRejected = (errorMsg: string): boolean => {
    const lowerMsg = errorMsg.toLowerCase()
    return lowerMsg.includes('rejected') ||
           lowerMsg.includes('denied') ||
           lowerMsg.includes('user rejected') ||
           lowerMsg.includes('user denied') ||
           lowerMsg.includes('cancelled')
  }

  // 清理 FHE timer
  const clearFheTimer = useCallback(() => {
    if (fheTimerRef.current) {
      clearInterval(fheTimerRef.current)
      fheTimerRef.current = null
    }
  }, [])

  // 清理 countdown timer
  const clearCountdownTimer = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      clearFheTimer()
      clearCountdownTimer()
    }
  }, [clearFheTimer, clearCountdownTimer])

  const { data: usdcBalance, refetch: refetchUsdcBalance } = useReadContract({
    address: CONTRACTS.MOCK_USDC as `0x${string}`,
    abi: ABIS.MockUSDC,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address }
  })

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.MOCK_USDC as `0x${string}`,
    abi: ABIS.MockUSDC,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.EUSDC as `0x${string}`] : undefined,
    query: { enabled: isConnected && !!address }
  })

  const { data: eUSDCHandle, refetch: refetchEusdcHandle } = useReadContract({
    address: CONTRACTS.EUSDC as `0x${string}`,
    abi: ABIS.EUSDC,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address }
  })

  const { data: wlData } = useReadContract({
    address: CONTRACTS.EUSDC as `0x${string}`,
    abi: ABIS.EUSDC,
    functionName: 'getFullWhitelist',
    query: { enabled: isConnected }
  })

  // FHE 处理完成后的自动解密（定义在 eUSDCHandle 之后）
  const autoDecryptAfterFhe = useCallback(async () => {
    // 如果没有地址，直接完成
    if (!address) {
      setFheStatus('complete')
      setFheProgress(100)
      setStatusStep('Transaction confirmed!')
      setTimeout(() => {
        setFheStatus('idle')
        setFheProgress(0)
        setStatusStep(null)
        setLastTxType(null)
      }, 2000)
      return
    }

    // 检查 handle 是否为空（余额为0）
    const emptyHandle = '0x0000000000000000000000000000000000000000000000000000000000000000'
    if (!eUSDCHandle || eUSDCHandle === emptyHandle) {
      setBalance('0')
      setIsBalanceHidden(false)
      setFheStatus('complete')
      setFheProgress(100)
      setStatusStep('Balance updated: 0 eUSDC')
      setTimeout(() => {
        setFheStatus('idle')
        setFheProgress(0)
        setStatusStep(null)
        setLastTxType(null)
      }, 2000)
      return
    }

    setFheStatus('decrypting')
    setDecrypting(true)
    setError(null)

    try {
      await initFhe()
      await ensureWalletConnected()
      const bal = await decryptHandle(eUSDCHandle as string)
      setBalance(bal)
      setIsBalanceHidden(false) // 解密成功后显示余额
      setFheStatus('complete')
      setFheProgress(100)
      setStatusStep('Balance updated!')

      // Decrypt 成功后刷新 MockUSDC 余额（withdraw 操作时 USDC transfer 已执行）
      refetchUsdcBalance()

      // 2秒后重置状态
      setTimeout(() => {
        setFheStatus('idle')
        setFheProgress(0)
        setStatusStep(null)
        setLastTxType(null)
      }, 2000)
    } catch (e: any) {
      setError(e.message)
      setFheStatus('error')
      setStatusStep('Decryption failed')
    } finally {
      setDecrypting(false)
    }
  }, [address, eUSDCHandle, refetchUsdcBalance])

  // 开始交易确认弹窗
  const startTxModal = useCallback(() => {
    setPreviousTab(activeTab)
    setShowTxModal(true)
    setTxModalPhase('confirming')
    setBroadcastTxHash(null)
    clearCountdownTimer()
  }, [activeTab, clearCountdownTimer])

  // 交易广播后的处理（等待300ms后显示hash）
  const handleTxBroadcasted = useCallback(async (hash: string) => {
    await new Promise(resolve => setTimeout(resolve, 300))
    setBroadcastTxHash(hash)
    setTxModalPhase('broadcasted')
  }, [])

  // 交易完成后的处理
  const handleTxCompleted = useCallback((hash: string) => {
    setTxHash(hash)
    setTxModalPhase('completed')
    setCountdownSeconds(5)

    // 开始倒计时
    const startCount = Date.now()
    countdownRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startCount) / 1000)
      const remaining = 5 - elapsed
      setCountdownSeconds(remaining)

      if (remaining <= 0) {
        clearCountdownTimer()
        setShowTxModal(false)
        setActiveTab('deposit') // 返回主页面
        setFheStatus('idle')
        setFheProgress(0)
        setStatusStep(null)
        setLastTxType(null)
      }
    }, 1000)
  }, [clearCountdownTimer])

  // 手动关闭弹窗返回之前页面
  const handleTxModalOk = useCallback(() => {
    clearCountdownTimer()
    setShowTxModal(false)
    setActiveTab(previousTab)
    setFheStatus('idle')
    setFheProgress(0)
    setStatusStep(null)
    setLastTxType(null)
  }, [clearCountdownTimer, previousTab])

  // 处理交易确认后的 FHE 状态
  useEffect(() => {
    if (isConfirmed && pendingTxHash && lastTxType) {
      // 交易上链确认，更新弹窗状态
      handleTxCompleted(pendingTxHash)
      setPendingTxHash(null)
      setOperationPhase('idle') // 重置操作阶段

      // 刷新合约数据
      refetchEusdcHandle()
      refetchAllowance()

      // Deposit 操作：USDC 在交易确认时已转移，立即刷新余额
      // Withdraw 操作：USDC transfer 需等 plaintext 计算后执行，在 decrypt 成功后刷新
      if (lastTxType === 'deposit') {
        refetchUsdcBalance()
      }

      // 交易确认后，开始 FHE 处理阶段
      setFheStatus('fhe-processing')
      setStatusStep('Processing encrypted balance...')

      // 启动进度条动画
      const startTime = Date.now()
      fheTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime
        const progress = Math.min((elapsed / FHE_PROCESSING_TIME) * 100, 95)
        setFheProgress(progress)
      }, 500)

      // 等待 FHE 处理完成
      const fheTimeout = setTimeout(() => {
        clearFheTimer()
        setFheProgress(100)
        setStatusStep('Encryption complete!')
        setFheStatus('ready-to-decrypt')

        // 自动开始解密
        setTimeout(() => {
          autoDecryptAfterFhe()
        }, 500)
      }, FHE_PROCESSING_TIME)

      return () => {
        clearTimeout(fheTimeout)
        clearFheTimer()
      }
    }
  }, [isConfirmed, pendingTxHash, lastTxType, clearFheTimer, autoDecryptAfterFhe, refetchEusdcHandle, refetchUsdcBalance, refetchAllowance, handleTxCompleted])

  // 处理 Approve 交易确认（不需要 FHE 处理）
  useEffect(() => {
    if (isConfirmed && pendingTxHash && !lastTxType) {
      setTxHash(pendingTxHash)
      setPendingTxHash(null)
      setStatusStep('Approved successfully!')
      setFheStatus('idle')

      // 刷新 allowance 和 balance
      refetchAllowance()
      refetchUsdcBalance()

      // 3秒后清除状态
      setTimeout(() => {
        setStatusStep(null)
        setTxHash(null)
      }, 3000)
    }
  }, [isConfirmed, pendingTxHash, lastTxType, refetchAllowance, refetchUsdcBalance])

  useEffect(() => {
    if (wlData) setWhitelist(wlData as string[])
  }, [wlData])

  const handleEnterAuditor = async () => {
    if (!address) return
    setShowAuthModal(true)
    setAuthChecking(true)
    setAuthResult('checking')
    
    try {
      const wl = wlData as string[] || []
      const isAuthorized = wl.some(addr => addr.toLowerCase() === address.toLowerCase())
      
      if (isAuthorized) {
        setAuthResult('authorized')
        setTimeout(() => {
          setShowAuthModal(false)
          setShowAuditor(true)
        }, 800)
      } else {
        setAuthResult('denied')
      }
    } catch (e) {
      setAuthResult('denied')
    } finally {
      setAuthChecking(false)
    }
  }

  const handleConnect = async () => {
    try {
      // 使用 wagmi v2 的 connectors，连接时指定目标网络
      const connector = connectors[0]
      if (connector) {
        await connect({ connector, chainId: pharos.id })
      }
    } catch (e: any) {
      console.error('Connect error:', e)
      setError(e.message)
    }
  }
  const handleSwitch = () => switchChain?.({ chainId: pharos.id })

  const usdcBal = usdcBalance ? ethers.formatUnits(usdcBalance as bigint, 6) : '0'
  const allowanceVal = allowance ? ethers.formatUnits(allowance as bigint, 6) : '0'
  const maxDeposit = Math.min(parseFloat(usdcBal), parseFloat(allowanceVal))
  const needsApprove = allowance ? (ethers.parseUnits(amount || '0', 6) > (allowance as bigint)) : true
  const hasAllowance = allowance && (allowance as bigint) > 0
  const isBob = address?.toLowerCase() === BOB_ADDRESS.toLowerCase()

  const handleDecrypt = async () => {
    // 先刷新 handle，确保获取最新值
    const { data: freshHandle } = await refetchEusdcHandle()

    // 检查 handle 是否为空（未初始化的余额 = 0）
    const emptyHandle = "0x0000000000000000000000000000000000000000000000000000000000000000"
    const currentHandle = freshHandle || eUSDCHandle
    if (!currentHandle || currentHandle === emptyHandle) {
      setBalance("0")
      setIsBalanceHidden(false)
      return
    }
    setDecrypting(true)
    setError(null)
    setStatusStep('Decrypting...')

    try {
      await initFhe()
      await ensureWalletConnected()

      // 准备解密 payload（获取用户签名，只需签名一次）
      const payload = await prepareDecryptPayload(currentHandle as string)

      // 调用后端轮询 API
      const response = await fetch('/api/decrypt-retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: payload.handle,
          valueType: payload.valueType,
          userAddress: payload.userAddress,
          aclAddress: payload.aclAddress,
          signature: payload.signature,
          timestamp: payload.timestamp,
        }),
      })

      const result = await response.json()

      if (result.success) {
        setBalance(result.balance)
        setIsBalanceHidden(false) // 解密成功后显示余额
        setStatusStep(null)
      } else {
        setError(result.error || 'Decryption failed')
        setStatusStep(null)
      }
    } catch (e: any) {
      setError(e.message)
      setStatusStep(null)
    } finally {
      setDecrypting(false)
    }
  }

  const handleApprove = async () => {
    if (!amount) return
    setStatusStep('Waiting for signature...')
    setError(null)
    setTxHash(null)
    setLastTxType(null) // Approve 不触发 FHE 处理
    try {
      const amt = ethers.parseUnits(amount, 6)
      const hash = await writeContractAsync({
        address: CONTRACTS.MOCK_USDC as `0x${string}`,
        abi: ABIS.MockUSDC,
        functionName: 'approve',
        args: [CONTRACTS.EUSDC as `0x${string}`, amt],
      })
      setPendingTxHash(hash)
      setStatusStep('Waiting for confirmation...')
    } catch (e: any) {
      setError(e.message)
      setStatusStep(null)
    }
  }

  const handleDeposit = async () => {
    if (!amount || !address) return
    if (isWrongChain) {
      setError('Please switch to Pharos network first')
      return
    }
    setError(null)
    setTxHash(null)
    setBalance(null)  // 隐藏右侧余额，变成 View 状态
    setFheStatus('tx-confirming')
    setFheProgress(0)
    setOperationPhase('submitting')
    startTxModal() // 显示确认弹窗
    try {
      const amt = ethers.parseUnits(amount, 6)
      const usdcAddress = CONTRACTS.MOCK_USDC as `0x${string}`
      const eusdcAddress = CONTRACTS.EUSDC as `0x${string}`

      // Get nonce from MockUSDC contract
      const provider = new ethers.JsonRpcProvider('https://atlantic.dplabs-internal.com')
      const usdcContract = new ethers.Contract(usdcAddress, ['function nonces(address) view returns (uint256)'], provider)
      const nonce = await usdcContract.nonces(address)

      // Deadline: 1 hour from now
      const deadline = Math.floor(Date.now() / 1000) + 3600

      // EIP-2612 Permit typed data
      const domain = {
        name: 'Mock USDC',
        version: '1',
        chainId: chainId, // 使用动态 chainId，不硬编码
        verifyingContract: usdcAddress,
      }

      const types = {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      }

      const value = {
        owner: address,
        spender: eusdcAddress,
        value: amt.toString(),
        nonce: nonce.toString(),
        deadline: deadline,
      }

      setStatusStep('Waiting for permit signature...')

      // Sign the permit
      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType: 'Permit',
        message: value,
      })

      // Split signature into v, r, s
      const sig = ethers.Signature.from(signature)

      setOperationPhase('confirming')
      setStatusStep('Waiting for deposit signature...')

      // Call depositWithPermit
      const hash = await writeContractAsync({
        address: eusdcAddress,
        abi: ABIS.EUSDC,
        functionName: 'depositWithPermit',
        args: [amt, BigInt(deadline), sig.v, sig.r as `0x${string}`, sig.s as `0x${string}`],
        value: BigInt(10 ** 15),
      })

      handleTxBroadcasted(hash)  // 等待300ms后显示hash
      setPendingTxHash(hash)
      setLastTxType('deposit')
      setAmount('')
    } catch (e: any) {
      // 用户拒绝时显示灰色 Toast，不显示红色错误
      if (isUserRejected(e.message)) {
        showToast('Transaction rejected by user')
        // 清除状态，不显示 Operation Status
        setStatusStep(null)
        setFheStatus('idle')
      } else {
        setError(e.message)
        setFheStatus('error')
      }
      setShowTxModal(false) // 关闭弹窗
      setOperationPhase('idle')
    }
  }

  const handleTransfer = async () => {
    if (!toAddress || !amount) return
    if (isWrongChain) {
      setError('Please switch to Pharos network first')
      return
    }
    setError(null)
    setTxHash(null)
    setBalance(null)  // 隐藏右侧余额，变成 View 状态
    setFheStatus('tx-confirming')
    setFheProgress(0)
    setOperationPhase('encrypting')
    startTxModal() // 显示确认弹窗
    try {
      await initFhe()
      await ensureWalletConnected()
      const encrypted = await encryptAmount(amount)
      setOperationPhase('confirming')
      const hash = await writeContractAsync({
        address: CONTRACTS.EUSDC as `0x${string}`,
        abi: ABIS.EUSDC,
        functionName: 'transfer',
        args: [toAddress as `0x${string}`, {
          handle: encrypted.handle,
          dataType: encrypted.dataType,
          data: encrypted.data,
        }],
        value: BigInt(10 ** 15),
        gas: BigInt(500000),
      })
      handleTxBroadcasted(hash)  // 等待300ms后显示hash
      setPendingTxHash(hash)
      setLastTxType('transfer')
      setAmount('')
      setToAddress('')
    } catch (e: any) {
      // 用户拒绝时显示灰色 Toast，不显示红色错误
      if (isUserRejected(e.message)) {
        showToast('Transaction rejected by user')
        // 清除状态，不显示 Operation Status
        setStatusStep(null)
        setFheStatus('idle')
      } else {
        setError(e.message)
        setFheStatus('error')
      }
      setShowTxModal(false) // 关闭弹窗
      setOperationPhase('idle')
    }
  }

  const handleWithdraw = async () => {
    if (!toAddress || !amount) return
    if (isWrongChain) {
      setError('Please switch to Pharos network first')
      return
    }
    setError(null)
    setTxHash(null)
    setBalance(null)  // 隐藏右侧余额，变成 View 状态
    setFheStatus('tx-confirming')
    setFheProgress(0)
    setOperationPhase('submitting')
    startTxModal() // 显示确认弹窗
    try {
      const amt = ethers.parseUnits(amount, 6)
      setOperationPhase('confirming')
      const hash = await writeContractAsync({
        address: CONTRACTS.EUSDC as `0x${string}`,
        abi: ABIS.EUSDC,
        functionName: 'claim',
        args: [toAddress as `0x${string}`, amt],
        value: BigInt(10 ** 15),
      })
      handleTxBroadcasted(hash)  // 等待300ms后显示hash
      setPendingTxHash(hash)
      setLastTxType('withdraw')
      setAmount('')
      setToAddress('')
    } catch (e: any) {
      // 用户拒绝时显示灰色 Toast，不显示红色错误
      if (isUserRejected(e.message)) {
        showToast('Transaction rejected by user')
        // 清除状态，不显示 Operation Status
        setStatusStep(null)
        setFheStatus('idle')
      } else {
        setError(e.message)
        setFheStatus('error')
      }
      setShowTxModal(false) // 关闭弹窗
      setOperationPhase('idle')
    }
  }

  const handleAddWhitelist = async () => {
    if (!whitelistAddr || !ethers.isAddress(whitelistAddr)) return
    setError(null)
    writeContractAsync({
      address: CONTRACTS.EUSDC as `0x${string}`,
      abi: ABIS.EUSDC,
      functionName: 'addToWhitelist',
      args: [whitelistAddr as `0x${string}`],
    })
    setWhitelistAddr('')
  }

  const handleSyncUsers = async () => {
    setSyncing(true)
    setAuditorError(null)
    try {
      const response = await fetch('/api/sync-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      })
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Sync failed')
      }
      
      // 获取更新后的用户列表
      const balancesResponse = await fetch('/api/all-user-balances')
      const balancesData = await balancesResponse.json()
      
      setAllUsers(balancesData.users || [])
      
      console.log('[sync] Synced', data.totalUsers, 'users')
    } catch (e: any) {
      setAuditorError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  const handleDecryptSingleUser = async (address: string, handle: string) => {
    const emptyHandle = '0x0000000000000000000000000000000000000000000000000000000000000000'
    if (!handle || handle === emptyHandle) {
      setAllUserBalances(prev => ({ ...prev, [address]: '0' }))
      return
    }
    
    setDecryptingUser(address)
    setAuditorError(null)
    try {
      await initFhe()
      await ensureWalletConnected()
      const decrypted = await decryptHandle(handle)
      setAllUserBalances(prev => ({ ...prev, [address]: decrypted }))
    } catch (e: any) {
      setAuditorError(e.message)
      setAllUserBalances(prev => ({ ...prev, [address]: 'error' }))
    } finally {
      setDecryptingUser(null)
    }
  }

  return (
    <div className="h-screen flex flex-col relative">
      {/* Header */}
      <header className="border-b border-black-border px-12 py-4 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-10">
          <div className="flex items-center gap-4">
            <img
              src="/primus-logo.svg"
              alt="Primus Labs"
              className="h-8"
              style={{ filter: 'brightness(1.1)' }}
            />
            <span className="text-lg font-semibold gradient-text">Auditable Private Transfer</span>
          </div>

          {isConnected && (
            <button
              onClick={showAuditor ? () => setShowAuditor(false) : handleEnterAuditor}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                showAuditor
                  ? 'text-orange border-b-2 border-orange'
                  : 'text-gray hover:text-white'
              }`}
            >
              {showAuditor ? '← Main Page' : 'Auditor Portal'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          {isWrongChain ? (
            <button onClick={handleSwitch} disabled={switching} className="status-badge status-disconnected">
              <span className="w-2 h-2 rounded-full bg-gray animate-pulse-slow"/>
              {switching ? 'Switching...' : 'Switch to Pharos'}
            </button>
          ) : isConnected && address ? (
            <>
              <span className="status-badge status-connected">
                <span className="w-2 h-2 rounded-full bg-success"/>
                Pharos
              </span>
              <div className="address-chip">
                {address.slice(0, 6)}...{address.slice(-4)}
              </div>
              <button onClick={() => disconnect()} className="text-sm text-gray hover:text-white transition-colors">
                Disconnect
              </button>
            </>
          ) : (
            <button onClick={handleConnect} className="btn-primary px-4 py-2 rounded text-sm font-medium">
              Connect
            </button>
          )}
        </div>
      </header>

      {/* Math decoration with drift animation */}
      <div className="math-overlay animate-drift top-20 right-8">
        E(x) = x² + k
      </div>
      <div className="math-overlay animate-drift top-40 left-12">
        ∀a,b: Enc(a+b) = Enc(a)+Enc(b)
      </div>

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {!showAuditor ? (
          <>
            {/* Left panel - Operations */}
            <div className="flex-1 p-12 flex flex-col justify-center animate-fadeIn">
              <div className="panel p-8 w-[800px] mx-auto">
                {/* Tabs - Segmented Control */}
                <div className="flex bg-black rounded-xl p-1 mb-8">
                  {(['deposit', 'transfer', 'withdraw'] as Tab[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 py-3 rounded-lg text-sm font-medium transition-all ${
                        activeTab === tab
                          ? 'bg-[rgba(255,159,47,0.12)] text-orange'
                          : 'text-gray hover:text-white'
                      }`}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Content */}
                <div className="space-y-6">
                  {activeTab === 'deposit' && (
                    <>
                      <input
                        type="text"
                        value={address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''}
                        placeholder="Recipient (your address)"
                        className="input w-full px-4 py-3"
                        disabled
                      />
                      {/* Amount input with MAX button */}
                      <div className="relative">
                        <input
                          type="text"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="Amount"
                          className="input w-full px-4 py-3 text-lg pr-24"
                        />
                        <button
                          onClick={() => setAmount(usdcBal)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-orange hover:text-orange-light font-medium px-2 py-1 rounded bg-black-light/50"
                        >
                          MAX
                        </button>
                        <span className="absolute right-16 top-1/2 -translate-y-1/2 text-xs text-gray-dark">USDC</span>
                      </div>
                      <button onClick={handleDeposit} disabled={isPending || !amount || isWrongChain} className="btn-primary w-full py-3 rounded font-medium">
                        {isWrongChain ? 'Switch Network First' :
                         operationPhase === 'submitting' ? 'Signing...' :
                         operationPhase === 'confirming' ? 'Confirming...' :
                         'Deposit'}
                      </button>
                    </>
                  )}

                  {activeTab === 'transfer' && (
                    <>
                      <input
                        type="text"
                        value={toAddress}
                        onChange={(e) => setToAddress(e.target.value)}
                        placeholder="Enter wallet address (0x...)"
                        className="input w-full px-4 py-3"
                      />
                      {/* Amount input with MAX button */}
                      <div className="relative">
                        <input
                          type="text"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="Amount"
                          className="input w-full px-4 py-3 text-lg pr-24"
                        />
                        {balance && parseFloat(balance) > 0 && (
                          <button
                            onClick={() => setAmount(balance)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-orange hover:text-orange-light font-medium px-2 py-1 rounded bg-black-light/50"
                          >
                            MAX
                          </button>
                        )}
                        <span className="absolute right-16 top-1/2 -translate-y-1/2 text-xs text-gray-dark">eUSDC</span>
                      </div>
                      <button onClick={handleTransfer} disabled={isPending || !toAddress || !amount || isWrongChain} className="btn-primary w-full py-3 rounded font-medium">
                        {isWrongChain ? 'Switch Network First' :
                         operationPhase === 'encrypting' ? 'Encrypting...' :
                         operationPhase === 'confirming' ? 'Submitting...' :
                         'Transfer'}
                      </button>
                    </>
                  )}

                  {activeTab === 'withdraw' && (
                    <>
                      <input
                        type="text"
                        value={toAddress}
                        onChange={(e) => setToAddress(e.target.value)}
                        placeholder="Enter wallet address (0x...)"
                        className="input w-full px-4 py-3"
                      />
                      {/* Amount input with MAX button */}
                      <div className="relative">
                        <input
                          type="text"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="Amount"
                          className="input w-full px-4 py-3 text-lg pr-24"
                        />
                        {balance && parseFloat(balance) > 0 && (
                          <button
                            onClick={() => setAmount(balance)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-orange hover:text-orange-light font-medium px-2 py-1 rounded bg-black-light/50"
                          >
                            MAX
                          </button>
                        )}
                        <span className="absolute right-16 top-1/2 -translate-y-1/2 text-xs text-gray-dark">eUSDC</span>
                      </div>
                      <button onClick={handleWithdraw} disabled={isPending || !toAddress || !amount || isWrongChain} className="btn-primary w-full py-3 rounded font-medium">
                        {isWrongChain ? 'Switch Network First' :
                         operationPhase === 'submitting' ? 'Signing...' :
                         operationPhase === 'confirming' ? 'Confirming...' :
                         'Withdraw'}
                      </button>
                    </>
                  )}

{error && (
                      <div className="bg-black-medium rounded p-4 mt-4 border border-error">
                        <span className="text-sm text-error">Error: {error}</span>
                      </div>
                    )}
                </div>
              </div>
            </div>

            {/* Right sidebar - Balance */}
            <aside className="sidebar w-72 p-8 flex flex-col animate-fadeIn">
              <h3 className="text-sm font-medium text-gray mb-6">Encrypted Balance</h3>
              <div className="panel p-6 flex flex-col items-center justify-center min-h-[200px]">
                {/* FHE Processing State */}
                {fheStatus === 'fhe-processing' && (
                  <div className="text-center w-full">
                    <div className="animate-spin w-6 h-6 border-2 border-orange border-t-transparent rounded-full mx-auto mb-3"/>
                    <p className="text-sm text-orange">Encrypting...</p>
                    <div className="h-1.5 bg-black-light rounded overflow-hidden mt-3 w-full">
                      <div
                        className="h-full bg-gradient-to-r from-orange to-success transition-all duration-500"
                        style={{ width: `${fheProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {fheStatus === 'decrypting' && (
                  <div className="text-center">
                    <div className="animate-spin w-6 h-6 border-2 border-success border-t-transparent rounded-full mx-auto mb-3"/>
                    <p className="text-sm text-success">Decrypting balance...</p>
                  </div>
                )}

                {fheStatus === 'complete' && balance && (
                  <div className="text-center animate-fadeIn">
                    <div className="balance-number">
                      <span className="balance-integer">{balance.split('.')[0] || balance}</span>
                      <span className="balance-decimal">.{balance.split('.')[1]?.slice(0,2) || '00'}</span>
                    </div>
                    <p className="balance-unit">eUSDC</p>
                    <span className="text-xs text-success mt-3 block">✓ Updated</span>
                    <button onClick={() => { setBalance(null); setFheStatus('idle'); }} className="text-xs text-gray mt-2 hover:text-white">
                      Hide
                    </button>
                  </div>
                )}

                {(fheStatus === 'idle' || fheStatus === 'tx-confirming') && (
                  <>
                    {/* 初始状态：显示 *** 和 View 按钮 */}
                    <div className="text-center">
                      <div className="balance-number">
                        {balance && !isBalanceHidden ? (
                          <>
                            <span className="balance-integer">{balance.split('.')[0] || balance}</span>
                            <span className="balance-decimal">.{balance.split('.')[1]?.slice(0,2) || '00'}</span>
                          </>
                        ) : (
                          <span className="balance-integer text-gray">***</span>
                        )}
                      </div>
                      <p className="balance-unit">eUSDC</p>
                      <button
                        onClick={() => {
                          if (isBalanceHidden || !balance) {
                            // View: 解密余额
                            handleDecrypt()
                          } else {
                            // Hide: 隐藏余额显示
                            setIsBalanceHidden(true)
                          }
                        }}
                        disabled={decrypting}
                        className="text-xs text-gray mt-4 hover:text-white disabled:opacity-50"
                      >
                        {decrypting ? 'Decrypting...' : (isBalanceHidden || !balance) ? 'View' : 'Hide'}
                      </button>
                    </div>
                  </>
                )}

                {fheStatus === 'error' && (
                  <div className="text-center">
                    <p className="text-error text-sm">Error occurred</p>
                    <button onClick={() => setFheStatus('idle')} className="text-xs text-gray mt-3 hover:text-white">
                      Reset
                    </button>
                  </div>
                )}
              </div>

              {/* MockUSDC Balance - Secondary display */}
              <div className="mt-6 p-4 bg-black-medium rounded">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-xs text-gray">USDC</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white whitespace-nowrap">
                      {isConnected ? `${parseFloat(usdcBal).toFixed(2)}` : '—'}
                    </span>
                    <button
                      onClick={() => refetchUsdcBalance()}
                      className="text-gray hover:text-white transition-colors"
                      title="Refresh USDC balance"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Operation Status - 显示加密/交易状态 */}
              {statusStep && !showAuditor && (
                <div className="mt-6 p-3 bg-black-light rounded border border-black-border">
                  <p className="text-xs text-gray mb-2 font-medium">Operation Status</p>
                  <div className="flex items-center gap-2">
                    {fheStatus === 'complete' ? (
                      <div className="w-3 h-3 rounded-full bg-success flex items-center justify-center">
                        <span className="text-white text-xs">✓</span>
                      </div>
                    ) : fheStatus === 'decrypting' ? (
                      <div className="animate-spin w-3 h-3 border-2 border-success border-t-transparent rounded-full"/>
                    ) : (
                      <div className="animate-spin w-3 h-3 border-2 border-orange border-t-transparent rounded-full"/>
                    )}
                    <span className={`text-xs ${fheStatus === 'complete' ? 'text-success' : fheStatus === 'decrypting' ? 'text-success' : 'text-orange'}`}>
                      {statusStep}
                    </span>
                  </div>

                  {/* FHE Progress Bar */}
                  {fheStatus === 'fhe-processing' && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-black rounded overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-orange to-success transition-all duration-500"
                          style={{ width: `${fheProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-dark mt-1">Processing... {Math.round(fheProgress)}%</p>
                    </div>
                  )}

                  {txHash && (
                    <a
                      href={`https://atlantic.pharosscan.xyz/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray hover:text-orange mt-2 block truncate"
                    >
                      Tx: {txHash.slice(0, 10)}...{txHash.slice(-8)}
                    </a>
                  )}
                </div>
              )}
            </aside>
          </>
        ) : (
          /* Auditor Portal */
          <div className="flex-1 p-8 flex flex-col justify-center animate-fadeIn">
            <div className="panel p-8 w-[900px] mx-auto">
              <h2 className="text-xl font-bold text-orange mb-6">Auditor Portal</h2>

              {/* 纵向分割成两部分 */}
              <div className="grid grid-cols-2 gap-6">
                {/* 左半部分：Whitelist Users */}
                <div className="flex flex-col">
                  <h3 className="text-sm font-medium text-gray mb-4">Whitelist Users</h3>
                  <p className="text-xs text-gray-dark mb-4">Addresses authorized to decrypt balances</p>

                  {/* 输入框区域 */}
                  <div className="mb-4">
                    {isBob && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={whitelistAddr}
                          onChange={(e) => setWhitelistAddr(e.target.value)}
                          placeholder="0x..."
                          className="input flex-1 px-3 py-2 text-sm"
                        />
                        <button onClick={handleAddWhitelist} disabled={isPending} className="btn-primary px-3 py-2 rounded text-sm font-medium">
                          {isPending ? '...' : 'Add'}
                        </button>
                      </div>
                    )}
                    {auditorError && <p className="text-error text-xs mt-2">{auditorError}</p>}
                  </div>

                  {/* Whitelist Users 列表 - 固定高度 + 滚动条 */}
                  <div className="h-[280px] overflow-y-auto border border-black-border rounded-lg p-3 bg-black-light">
                    {whitelist.length > 0 ? (
                      <div className="space-y-2">
                        {whitelist.map((addr) => (
                          <div key={addr} className="flex justify-between items-center p-2 bg-black-medium rounded">
                            <span className="text-xs text-white">{addr.slice(0, 6)}...{addr.slice(-4)}</span>
                            <span className="text-xs font-medium">
                              {whitelistBalances[addr]
                                ? `${parseFloat(whitelistBalances[addr]).toFixed(2)}`
                                : <span className="text-gray">—</span>
                              }
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray text-center text-sm">No auditors</p>
                    )}
                  </div>
                </div>

                {/* 右半部分：All Users */}
                <div className="flex flex-col">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-medium text-gray">All Users</h3>
                    <button
                      onClick={handleSyncUsers}
                      disabled={syncing}
                      className="btn-secondary px-2 py-1 rounded text-xs font-medium"
                    >
                      {syncing ? 'Syncing...' : 'Sync'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-dark mb-4">From Transfer events on chain</p>

                  {/* Total 区域 - 和左侧输入框对齐 */}
                  <div className="mb-4 p-3 bg-black-light rounded">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray">Total</span>
                      <span className="text-orange font-bold">
                        {Object.keys(allUserBalances).length > 0
                          ? Object.values(allUserBalances)
                              .filter(b => b !== 'error')
                              .reduce((sum, b) => sum + parseFloat(b), 0)
                              .toFixed(2) + ' eUSDC'
                          : '—'}
                      </span>
                    </div>
                  </div>

                  {/* All Users 列表 - 固定高度 + 滚动条 */}
                  <div className="h-[280px] overflow-y-auto border border-black-border rounded-lg p-3 bg-black-light">
                    {allUsers.length > 0 ? (
                      <div className="space-y-2">
                        {allUsers.map((user) => (
                          <div key={user.address} className="flex justify-between items-center p-2 bg-black-medium rounded">
                            <span className="text-xs text-white">{user.address.slice(0, 6)}...{user.address.slice(-4)}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-medium">
                                {allUserBalances[user.address]
                                  ? (allUserBalances[user.address] === 'error'
                                    ? <span className="text-error">err</span>
                                    : parseFloat(allUserBalances[user.address]).toFixed(2))
                                  : <span className="text-gray">{user.handle.slice(0, 6)}...</span>
                                }
                              </span>
                              {!allUserBalances[user.address] && (
                                <button
                                  onClick={() => handleDecryptSingleUser(user.address, user.handle)}
                                  disabled={decryptingUser === user.address}
                                  className="btn-secondary px-1 py-0.5 rounded text-xs"
                                >
                                  {decryptingUser === user.address ? '...' : 'Dec'}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray text-center text-sm">Click "Sync" to scan events</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="panel p-8 max-w-md mx-auto animate-fadeIn">
            {authResult === 'checking' && (
              <div className="text-center">
                <div className="w-12 h-12 border-2 border-orange border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
                <p className="text-gray">Checking auditor permission...</p>
              </div>
            )}
            {authResult === 'authorized' && (
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-success text-2xl">✓</span>
                </div>
                <p className="text-white font-medium">Access Granted</p>
                <p className="text-gray text-sm mt-2">You are in the auditor whitelist</p>
              </div>
            )}
            {authResult === 'denied' && (
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-error/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-error text-2xl">✗</span>
                </div>
                <p className="text-white font-medium">Access Denied</p>
                <p className="text-gray text-sm mt-2">You are not authorized to decrypt balances</p>
                <button
                  onClick={() => setShowAuthModal(false)}
                  className="btn-primary px-4 py-2 rounded mt-6"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transaction Confirmation Modal */}
      {showTxModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="panel p-8 max-w-md mx-auto animate-fadeIn">
            {txModalPhase === 'confirming' && (
              <div className="text-center">
                <div className="w-12 h-12 border-2 border-orange border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
                <p className="text-white font-medium">Confirming Transaction</p>
                <p className="text-gray text-sm mt-2">Please sign in your wallet...</p>
              </div>
            )}
            {txModalPhase === 'broadcasted' && broadcastTxHash && (
              <div className="text-center">
                <div className="w-12 h-12 border-2 border-orange border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
                <p className="text-white font-medium">Transaction Broadcasted</p>
                <p className="text-gray text-sm mt-2">Waiting for on-chain confirmation...</p>
                <div className="mt-4">
                  <p className="text-xs text-gray mb-1">Tx hash:</p>
                  <a
                    href={`https://atlantic.pharosscan.xyz/tx/${broadcastTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-orange hover:text-white transition-colors break-all"
                  >
                    {broadcastTxHash.slice(0, 20)}...{broadcastTxHash.slice(-12)}
                  </a>
                </div>
              </div>
            )}
            {txModalPhase === 'completed' && txHash && (
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-success text-2xl">✓</span>
                </div>
                <p className="text-white font-medium">Transaction completed!</p>
                <p className="text-gray text-sm mt-2">
                  You will be directed to the main page in {countdownSeconds} seconds.
                </p>
                <div className="mt-4">
                  <p className="text-xs text-gray mb-1">Tx hash:</p>
                  <a
                    href={`https://atlantic.pharosscan.xyz/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-orange hover:text-white transition-colors break-all"
                  >
                    {txHash}
                  </a>
                </div>
                <button
                  onClick={handleTxModalOk}
                  className="btn-primary px-6 py-2 rounded mt-6"
                >
                  OK
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-black-border px-6 py-3 flex items-center justify-between text-xs text-gray-dark">
        <span>
          Primus Labs ·
          <a
            href="https://fhetransform.primuslabs.xyz/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange hover:text-orange-light transition-colors"
          >
            FHE-based privacy
          </a>
        </span>
        <span>Protect Your Financial Details On-Chain</span>
      </footer>

      {/* Toast - 用户拒绝提示 */}
      {toastMessage && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 animate-fadeIn">
          <div className="bg-black-medium border border-gray-dark/30 rounded px-4 py-3 shadow-lg">
            <span className="text-sm text-gray">{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
  )
}