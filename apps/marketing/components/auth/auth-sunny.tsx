'use client';

import { SunnySpot } from '../sunny-spot.js';

/** Welcome: Sunny waves once, then rests on hips (guidelines C2). */
export function AuthSunny(): React.JSX.Element {
  return <SunnySpot pose="hips" sequence="listening-perk" size={260} className="auth-sunny" />;
}
