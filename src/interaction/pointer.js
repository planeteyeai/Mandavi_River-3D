// Pointer event handling
export function initPointer(renderer, scene, camera) {
  const pointer = { x: 0, y: 0 };
  renderer.domElement.addEventListener("mousemove", (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });
  return pointer;
}
