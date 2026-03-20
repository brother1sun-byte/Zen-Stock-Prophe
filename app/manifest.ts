import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'MinatoMirai Pro v8.0',
        short_name: 'MinatoMirai',
        description: 'Japan Stock Prophet - AI-Powered Trading Intelligence',
        start_url: '/',
        display: 'standalone',
        background_color: '#030712', // 深い紺色 (Slate-950)
        theme_color: '#10b981',      // プレゼンスネオン (Emerald-500)
        icons: [
            {
                src: '/icons/icon-192.png',
                sizes: '192x192',
                type: 'image/png',
            },
            {
                src: '/icons/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
            },
            {
                src: '/icons/maskable-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'maskable',
            },
            {
                src: '/icons/maskable-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
            },
        ],
    }
}
