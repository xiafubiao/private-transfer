// Layered Status UI Component for FHE operations

import { useState, useEffect } from 'react'

export type OperationStep = {
  id: string
  label: string
  status: 'pending' | 'active' | 'complete' | 'error'
  duration?: number // ms
  detail?: string
}

export type OperationType = 'deposit' | 'transfer' | 'withdraw'

// Standard operation steps
export const DEPOSIT_STEPS: OperationStep[] = [
  { id: 'prepare', label: 'Prepare permit', status: 'pending', detail: 'Getting nonce and building signature' },
  { id: 'sign', label: 'Sign permit', status: 'pending', detail: 'Wallet signature required' },
  { id: 'submit', label: 'Submit deposit', status: 'pending', detail: 'Sending to blockchain' },
  { id: 'confirm', label: 'Tx confirm', status: 'pending', detail: 'Waiting for block confirmation' },
  { id: 'fhe', label: 'FHE compute', status: 'pending', detail: 'AlphaTrion processing ciphertext' },
  { id: 'decrypt', label: 'Decrypt balance', status: 'pending', detail: 'Getting your new balance' },
]

export const TRANSFER_STEPS: OperationStep[] = [
  { id: 'encrypt', label: 'Encrypt amount', status: 'pending', detail: 'WASM encryption (local)' },
  { id: 'upload', label: 'Upload ciphertext', status: 'pending', detail: 'Sending to AlphaTrion' },
  { id: 'sign', label: 'Sign transfer', status: 'pending', detail: 'Wallet signature required' },
  { id: 'submit', label: 'Submit transfer', status: 'pending', detail: 'Sending to blockchain' },
  { id: 'confirm', label: 'Tx confirm', status: 'pending', detail: 'Waiting for block confirmation' },
  { id: 'fhe-sender', label: 'Update sender', status: 'pending', detail: 'Computing your new balance' },
  { id: 'fhe-receiver', label: 'Update receiver', status: 'pending', detail: 'Computing recipient balance' },
  { id: 'decrypt', label: 'Decrypt balance', status: 'pending', detail: 'Getting your new balance' },
]

export const WITHDRAW_STEPS: OperationStep[] = [
  { id: 'sign', label: 'Sign claim', status: 'pending', detail: 'Wallet signature required' },
  { id: 'submit', label: 'Submit claim', status: 'pending', detail: 'Sending to blockchain' },
  { id: 'confirm', label: 'Tx confirm', status: 'pending', detail: 'Waiting for block confirmation' },
  { id: 'fhe-check', label: 'Check balance', status: 'pending', detail: 'Verifying encrypted balance >= amount' },
  { id: 'fhe-callback', label: 'Execute callback', status: 'pending', detail: 'AlphaTrion calling USDC transfer' },
  { id: 'usdc-transfer', label: 'USDC transfer', status: 'pending', detail: 'Receiving USDC to your address' },
]

interface LayeredStatusProps {
  operationType: OperationType
  steps: OperationStep[]
  currentStepIndex: number
  txHash?: string
  error?: string
  onComplete?: () => void
}

export function LayeredStatus({
  operationType,
  steps,
  currentStepIndex,
  txHash,
  error,
  onComplete,
}: LayeredStatusProps) {
  // Calculate overall progress
  const progress = ((currentStepIndex + 1) / steps.length) * 100
  const isComplete = currentStepIndex >= steps.length - 1 && steps[steps.length - 1].status === 'complete'
  const hasError = steps.some(s => s.status === 'error')

  // Auto-trigger onComplete when all steps done
  useEffect(() => {
    if (isComplete && onComplete) {
      setTimeout(onComplete, 1000)
    }
  }, [isComplete, onComplete])

  return (
    <div className="layered-status">
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm font-medium text-white">
          {operationType.charAt(0).toUpperCase() + operationType.slice(1)}
        </span>
        <span className="text-xs text-gray">
          Step {Math.min(currentStepIndex + 1, steps.length)} / {steps.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-black-light rounded overflow-hidden mb-4">
        <div
          className={`h-full transition-all duration-500 ${
            hasError
              ? 'bg-error'
              : isComplete
                ? 'bg-success'
                : 'bg-gradient-to-r from-orange to-success'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, index) => (
          <StepItem
            key={step.id}
            step={step}
            isActive={index === currentStepIndex}
            isPast={index < currentStepIndex}
          />
        ))}
      </div>

      {/* Tx hash */}
      {txHash && (
        <a
          href={`https://atlantic.pharosscan.xyz/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray hover:text-orange mt-3 block"
        >
          View tx: {txHash.slice(0, 10)}...{txHash.slice(-8)}
        </a>
      )}

      {/* Error */}
      {error && (
        <div className="mt-3 p-2 bg-error/10 rounded border border-error/30">
          <span className="text-xs text-error">{error}</span>
        </div>
      )}

      {/* Complete message */}
      {isComplete && (
        <div className="mt-3 p-2 bg-success/10 rounded border border-success/30 animate-fadeIn">
          <span className="text-xs text-success">✓ Operation complete!</span>
        </div>
      )}
    </div>
  )
}

// Individual step item
function StepItem({
  step,
  isActive,
  isPast,
}: {
  step: OperationStep
  isActive: boolean
  isPast: boolean
}) {
  const [showDetail, setShowDetail] = useState(false)

  const statusColor = {
    pending: 'text-gray',
    active: 'text-orange',
    complete: 'text-success',
    error: 'text-error',
  }[step.status]

  const statusIcon = {
    pending: <span className="w-4 h-4 rounded-full bg-gray/30" />,
    active: <div className="animate-spin w-4 h-4 border-2 border-orange border-t-transparent rounded-full" />,
    complete: <div className="w-4 h-4 rounded-full bg-success/20 flex items-center justify-center"><span className="text-success text-xs">✓</span></div>,
    error: <div className="w-4 h-4 rounded-full bg-error/20 flex items-center justify-center"><span className="text-error text-xs">✗</span></div>,
  }[step.status]

  return (
    <div
      className={`flex items-start gap-3 p-2 rounded transition-colors ${
        isActive ? 'bg-orange/5 border border-orange/20' : ''
      }`}
      onClick={() => setShowDetail(!showDetail)}
    >
      {/* Status icon */}
      <div className="flex-shrink-0 mt-0.5">
        {statusIcon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <span className={`text-sm font-medium ${statusColor}`}>
            {step.label}
          </span>
          {step.duration && (
            <span className="text-xs text-gray">
              {step.duration < 1000 ? `${step.duration}ms` : `${(step.duration / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>

        {/* Detail (expandable) */}
        {(showDetail || isActive) && step.detail && (
          <p className="text-xs text-gray mt-1 animate-fadeIn">
            {step.detail}
          </p>
        )}
      </div>
    </div>
  )
}

// Compact status for sidebar
interface CompactStatusProps {
  operationType: OperationType
  currentStepIndex: number
  totalSteps: number
  isComplete: boolean
  hasError: boolean
}

export function CompactStatus({
  operationType,
  currentStepIndex,
  totalSteps,
  isComplete,
  hasError,
}: CompactStatusProps) {
  const progress = ((currentStepIndex + 1) / totalSteps) * 100

  return (
    <div className="compact-status text-center w-full">
      {/* Spinner or check */}
      {hasError ? (
        <div className="w-6 h-6 rounded-full bg-error/20 flex items-center justify-center mx-auto mb-2">
          <span className="text-error text-sm">✗</span>
        </div>
      ) : isComplete ? (
        <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-2">
          <span className="text-success text-sm">✓</span>
        </div>
      ) : (
        <div className="animate-spin w-6 h-6 border-2 border-orange border-t-transparent rounded-full mx-auto mb-2" />
      )}

      {/* Label */}
      <p className={`text-sm ${hasError ? 'text-error' : isComplete ? 'text-success' : 'text-orange'}`}>
        {hasError ? 'Error' : isComplete ? 'Complete' : `${operationType.charAt(0).toUpperCase() + operationType.slice(1)}...`}
      </p>

      {/* Progress bar */}
      {!isComplete && !hasError && (
        <div className="h-1.5 bg-black-light rounded overflow-hidden mt-2 w-full">
          <div
            className="h-full bg-gradient-to-r from-orange to-success transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Step indicator */}
      {!isComplete && !hasError && (
        <p className="text-xs text-gray mt-1">
          Step {Math.min(currentStepIndex + 1, totalSteps)}
        </p>
      )}
    </div>
  )
}