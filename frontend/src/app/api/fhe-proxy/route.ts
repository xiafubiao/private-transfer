import { NextRequest, NextResponse } from 'next/server'
import { decryptViaGrpc } from '@/lib/grpc-client'

const ALPHA_TRION_URL = process.env.ALPHA_TRION_URL || 'http://34.84.204.187:38081'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { method, params } = body

    console.log('[fhe-proxy] method:', method)

    if (method === 'query_for_decryption') {
      const payload = params?.[0]?.[0] || params?.[0]
      console.log('[fhe-proxy] decryption payload:', JSON.stringify(payload, null, 2))
      
      try {
        const results = await decryptViaGrpc(payload)
        console.log('[fhe-proxy] decryption results:', results)
        
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: results.map(r => ({
            handle: r.handle,
            value: r.value,
          })),
        })
      } catch (grpcError: any) {
        console.error('[fhe-proxy] gRPC error:', grpcError.message)
        return NextResponse.json({ 
          error: { code: 500, message: grpcError.message }
        }, { status: 500 })
      }
    }

    const response = await fetch(ALPHA_TRION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    const data = await response.json()
    console.log('[fhe-proxy] AlphaTrion response:', data)
    
    return NextResponse.json(data)
  } catch (error: any) {
    console.error('[fhe-proxy] error:', error)
    return NextResponse.json({ error: { code: 500, message: error.message } }, { status: 500 })
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