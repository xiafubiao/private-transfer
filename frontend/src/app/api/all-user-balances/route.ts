// API: 获取所有用户余额 handles
import { NextResponse } from 'next/server';
import { getAllUserHandles } from '@/lib/user-store';

export async function GET() {
  try {
    const handles = getAllUserHandles();
    
    const users = Object.entries(handles).map(([address, handle]) => ({
      address,
      handle,
    }));
    
    return NextResponse.json({
      users,
      total: users.length,
      updatedAt: Date.now(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}