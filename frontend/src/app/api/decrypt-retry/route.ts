import { NextRequest, NextResponse } from 'next/server'
import { decryptViaGrpc } from '@/lib/grpc-client'

// 轮询解密 API - 1秒间隔，最多15次（15秒）
const MAX_RETRIES = 15
const RETRY_INTERVAL = 1000

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { handle, valueType, userAddress, aclAddress, signature, timestamp } = body

    console.log('[decrypt-retry] Starting retry decryption for handle:', handle)

    const payload = {
      handle: handle,
      valueType: valueType,
      userAddress: userAddress,
      aclContractAddress: aclAddress,
      signature: signature,
      timestamp: timestamp,
    }

    // 轮询解密
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      console.log(`[decrypt-retry] Attempt ${attempt + 1}/${MAX_RETRIES}`)

      try {
        const results = await decryptViaGrpc(payload)

        if (results && results[0]?.value) {
          const valueHex = results[0].value
          const plaintext = parseInt(valueHex, 16)

          console.log('[decrypt-retry] Got plaintext:', plaintext)

          // plaintext 存在即返回成功（plaintext 是固定的，不会变化）
          const balance = plaintext / 1e6  // decimals = 6
          return NextResponse.json({
            success: true,
            value: valueHex,
            balance: balance.toFixed(2),
            attempts: attempt + 1,
          })
        }
      } catch (grpcError: any) {
        console.log('[decrypt-retry] gRPC error:', grpcError.message)

        // 如果是 plaintext 未就绪 (404/not available)，继续轮询
        if (grpcError.message?.includes('not available') ||
            grpcError.message?.includes('404') ||
            grpcError.message?.includes('not found')) {
          // 继续下一次尝试
        } else {
          // 其他错误，直接返回
          return NextResponse.json({
            success: false,
            error: grpcError.message,
          }, { status: 500 })
        }
      }

      // 等待 1 秒后重试
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL))
      }
    }

    // 超时
    return NextResponse.json({
      success: false,
      error: 'Balance still processing. Please try again later.',
      attempts: MAX_RETRIES,
    })

  } catch (error: any) {
    console.error('[decrypt-retry] error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function OPTIONS() {
  return NextResponse.json(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}