'use client';

import dynamic from 'next/dynamic';

const Map = dynamic(() => import('./map'), {
  ssr: false,
  loading: () => <div className="h-full w-full flex items-center justify-center bg-gray-100">Laster kart...</div>
});

export default function Home() {
  return (
    <main className="h-screen w-screen">
      <Map />
    </main>
  );
}