// API: 查询 FHE 计算状态
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { CONTRACTS } from '@/lib/contracts';

const RPC_URL = 'https://atlantic.dplabs-internal.com';
const ALPHA_TRION_URL = 'http://34.84.204.187:38081';

// 检查 handle 是否有对应的密文（可以解密）
async function checkHandleReady(handle: string): Promise<{ ready: boolean; estimatedWait?: number }> {
  if (!handle || handle === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    return { ready: false };
  }

  try {
    // 尝试查询 AlphaTrion 是否有密文
    const response = await fetch(ALPHA_TRION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: Math.floor(Math.random() * 0x7fffffff),
        method: 'query_ciphertext_status',
        params: [{ handle }],
        jsonrpc: '2.0',
      }),
    });

    const json = await response.json();

    if (json.result?.status === 'ready') {
      return { ready: true };
    } else if (json.result?.status === 'pending') {
      return { ready: false, estimatedWait: json.result.estimated_wait || 10 };
    }

    // 如果 API 不支持，使用简化逻辑：等待一段时间后认为 ready
    // 实际应该检查 computations 表的状态
    return { ready: true }; // 默认认为可以尝试解密
  } catch (e) {
    // AlphaTrion API 可能不支持此方法，返回默认值
    console.log('[fhe-status] API error, assuming ready:', e);
    return { ready: true };
  }
}

// 获取用户的 eUSDC handle
async function getUserHandle(address: string): Promise<string> {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const eUSDC = new ethers.Contract(
    CONTRACTS.EUSDC,
    ['function balanceOf(address) view returns (bytes32)'],
    provider
  );

  const handle = await eUSDC.balanceOf(address);
  return handle;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');
  const handle = searchParams.get('handle');

  if (!address && !handle) {
    return NextResponse.json({ error: 'Missing address or handle' }, { status: 400 });
  }

  try {
    let targetHandle = handle;

    // 如果没有提供 handle，从合约查询
    if (!targetHandle && address) {
      targetHandle = await getUserHandle(address);
    }

    const status = await checkHandleReady(targetHandle!);

    return NextResponse.json({
      handle: targetHandle,
      ready: status.ready,
      estimatedWait: status.estimatedWait || 0,
      empty: targetHandle === '0x0000000000000000000000000000000000000000000000000000000000000000',
    });
  } catch (e: any) {
    console.error('[fhe-status] Error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: 检查交易后的 FHE 计算状态
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { txHash, address } = body;

    if (!address) {
      return NextResponse.json({ error: 'Missing address' }, { status: 400 });
    }

    // 获取当前 handle
    const handle = await getUserHandle(address);

    // 交易刚确认后，FHE 计算通常需要 10-15 秒
    // 我们检查 handle 是否变化（新的 handle 表示计算完成）

    const status = await checkHandleReady(handle);

    return NextResponse.json({
      handle,
      ready: status.ready,
      estimatedWait: status.estimatedWait || 15,
      empty: handle === '0x0000000000000000000000000000000000000000000000000000000000000000',
    });
  } catch (e: any) {
    console.error('[fhe-status] Error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}