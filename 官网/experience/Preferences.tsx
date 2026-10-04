import { useEffect,useRef } from 'react';
import { mountPreferenceControls } from '../dist/preferences.js';
export function Preferences() {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>mountPreferenceControls(ref.current!),[]);
  return <div ref={ref}/>;
}
