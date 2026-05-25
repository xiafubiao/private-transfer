// API: 同步用户地址和 handles
import { NextRequest, NextResponse } from 'next/server';
import { syncAllUsers } from '@/lib/user-sync';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const forceFullSync = body.force === true;
    
    console.log('[sync-users] Starting sync, forceFullSync:', forceFullSync);
    
    const data = await syncAllUsers(forceFullSync);
    
    return NextResponse.json({
      success: true,
      totalUsers: data.users.length,
      totalHandles: Object.keys(data.handles).length,
      lastSyncBlock: data.lastSyncBlock,
      updatedAt: data.updatedAt,
    });
  } catch (error: any) {
    console.error('[sync-users] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}