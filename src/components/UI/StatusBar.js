export function createStatusBar() {
  const bar = document.createElement("div");
  bar.className = "status-bar";
  bar.innerHTML = `
    <span class="status-item"><span class="status-dot real"></span>DATA: REAL GEOMETRY</span>
    <span class="status-item"><span class="status-dot real"></span>DEPTH: SURVEY</span>
    <span class="status-item"><span class="status-dot sim"></span>MODEL: SIMULATION</span>
  `;
  document.body.appendChild(bar);
}
