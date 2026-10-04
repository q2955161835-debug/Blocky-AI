export function mountDemo() {
  const frame = document.createElement('iframe');
  frame.className = 'experience-frame';
  frame.title = 'Blocky Studio 在线体验';
  frame.src = './studio/index.html';
  document.querySelector('#studio').replaceChildren(frame);
}
export function stopRun() {
  // Disposing the frame also disposes the canvas and preset timers.
  document.querySelector('#studio').replaceChildren();
}
