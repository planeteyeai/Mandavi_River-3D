/**
 * Estimate inundated water volume from corridor bathymetry + stage rise.
 * Volume ≈ Σ depth_effective × cell_area across surveyed/interpolated cells.
 * Outside survey envelope (UNAVAILABLE) cells are excluded from the total.
 *
 * @param {object} dataset
 * @param {{ stageRiseM?: number }} [opts]
 * @returns {{ volumeM3: number, wettedAreaM2: number, meanDepthM: number, cells: number, provenance: string, stageRiseM: number }}
 */
export function estimateWaterVolume(dataset, opts = {}) {
  const bath = dataset?.bathymetry;
  const stations = dataset?.corridor?.stations || [];
  const stageRiseM = Math.max(0, Number(opts.stageRiseM) || 0);
  if (!bath?.depths?.length || stations.length < 2) {
    return {
      volumeM3: 0,
      wettedAreaM2: 0,
      meanDepthM: 0,
      cells: 0,
      provenance: "UNAVAILABLE",
      stageRiseM,
    };
  }

  const across = dataset.corridor?.across ?? 36;
  const cols = across + 1;
  const rows = Math.floor(bath.depths.length / cols);
  const provenance = bath.provenance || [];
  let volume = 0;
  let area = 0;
  let depthSum = 0;
  let cells = 0;

  for (let r = 0; r < rows - 1; r++) {
    const stA = stations[Math.min(stations.length - 1, r)];
    const stB = stations[Math.min(stations.length - 1, r + 1)];
    const alongM = Math.max(
      1,
      Math.hypot((stB.x || 0) - (stA.x || 0), (stB.z || 0) - (stA.z || 0)),
    );
    const widthA = stA.width || 80;
    const widthB = stB.width || widthA;
    const cellAlong = alongM;
    const cellAcrossA = widthA / across;
    const cellAcrossB = widthB / across;

    for (let c = 0; c < cols - 1; c++) {
      const i00 = r * cols + c;
      const i10 = r * cols + c + 1;
      const i01 = (r + 1) * cols + c;
      const i11 = (r + 1) * cols + c + 1;
      const provs = [provenance[i00], provenance[i10], provenance[i01], provenance[i11]];
      const usable = provs.filter((p) => p && p !== "UNAVAILABLE").length;
      if (usable < 2) continue;

      const d00 = (bath.depths[i00] || 0) + stageRiseM;
      const d10 = (bath.depths[i10] || 0) + stageRiseM;
      const d01 = (bath.depths[i01] || 0) + stageRiseM;
      const d11 = (bath.depths[i11] || 0) + stageRiseM;
      const meanD = Math.max(0, (d00 + d10 + d01 + d11) / 4);
      const cellW = (cellAcrossA + cellAcrossB) / 2;
      const cellArea = cellAlong * cellW;
      volume += meanD * cellArea;
      area += cellArea;
      depthSum += meanD;
      cells++;
    }
  }

  const observedShare = provenance.filter((p) => p === "OBSERVED").length;
  const interpShare = provenance.filter((p) => p === "INTERPOLATED").length;
  let label = "MODELLED";
  if (observedShare > interpShare && observedShare > 0) label = "OBSERVED+INTERPOLATED";
  else if (interpShare > 0) label = "INTERPOLATED";
  if (stageRiseM > 0.01) label = "SIMULATED";

  return {
    volumeM3: Math.round(volume),
    wettedAreaM2: Math.round(area),
    meanDepthM: cells ? Number((depthSum / cells).toFixed(2)) : 0,
    cells,
    provenance: label,
    stageRiseM,
  };
}
