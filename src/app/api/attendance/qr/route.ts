import QRCode from 'qrcode';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const PRODUCTION_ORIGIN = 'https://latewatch.vercel.app';

export async function GET() {
  try {
    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL || PRODUCTION_ORIGIN;
    const installUrl = new URL('/install', configuredOrigin);

    const qrSvg = await QRCode.toString(installUrl.toString(), {
      color: {
        dark: '#2563eb',
        light: '#00000000',
      },
      errorCorrectionLevel: 'M',
      margin: 1,
      type: 'svg',
      width: 176,
    });

    return NextResponse.json({
      checkInUrl: installUrl.toString(),
      qrSvg,
      type: 'permanent_install_qr',
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to generate attendance QR code:', error);
    return NextResponse.json({ error: 'Failed to generate attendance QR code' }, { status: 500 });
  }
}
