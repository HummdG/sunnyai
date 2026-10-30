import type { MetadataRoute } from 'next';

/** The web app manifest: the name and colours a phone uses for a saved link. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sunny',
    short_name: 'Sunny',
    description: 'The AI assistant for solar installers.',
    start_url: '/',
    display: 'browser',
    background_color: '#fbf4e8',
    theme_color: '#ff7900',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
