import type { ComponentType } from 'react';

import MetroBoard from '@/demos/metro-board';
import MetroLive from '@/demos/metro-live';
import MetroOnboard from '@/demos/metro-onboard';
import MetroTap from '@/demos/metro-tap';
import SpringCard from '@/demos/spring-card';

export type Demo = {
  /** URL-safe id, used as the route param: /demo/<id> */
  id: string;
  title: string;
  description: string;
  author?: string;
  component: ComponentType;
  /** No floating close button: the demo pushes in and closes with the edge swipe instead */
  hideClose?: boolean;
};

/**
 * Add new demos here. Each demo lives in its own folder under src/demos/<id>/
 * and default-exports a full-screen component.
 */
export const demos: Demo[] = [
  {
    id: 'metro-live',
    title: 'Metro · Line 1 Live',
    description:
      'Real-map 3D Saigon with live trains (three.js + TypeGPU on WebGPU) and an Apple Maps-style native sheet.',
    author: 'VG Team',
    component: MetroLive,
    hideClose: true,
  },
  {
    id: 'metro-onboard',
    title: 'Metro · Onboard Display',
    description: 'HCMC Metro Line 1 door screen: live route, arrival chime, doors.',
    author: 'VG Team',
    component: MetroOnboard,
  },
  {
    id: 'metro-tap',
    title: 'Metro · Tap to Ride',
    description: 'Drag your metro card to the reader. Haptics thicken as it gets closer.',
    author: 'VG Team',
    component: MetroTap,
  },
  {
    id: 'metro-board',
    title: 'Metro · Platform Board',
    description: 'LED dot-matrix departures with stepping ticker, column wipe and car crowding.',
    author: 'VG Team',
    component: MetroBoard,
  },
  {
    id: 'spring-card',
    title: 'Spring Card',
    description: 'Drag the card around, release and it springs back.',
    author: 'VG Team',
    component: SpringCard,
  },
];

export function getDemo(id: string | undefined) {
  return demos.find((demo) => demo.id === id);
}
