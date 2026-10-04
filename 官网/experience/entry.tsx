import { createRoot } from 'react-dom/client';
import { DemoApp } from './DemoApp';
import '../../apps/studio-desktop/src/app/styles.css';
import '../../apps/studio-desktop/src/app/BuilderChat.css';
import './experience.css';
createRoot(document.getElementById('root')!).render(<DemoApp />);
