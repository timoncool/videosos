/**
 * Shared WGSL fullscreen-quad vertex stage.
 *
 * Used by every fragment-only GPU pass (effects, transitions, mask combine,
 * media blend, etc.). Prepend this to a fragment-shader source to get a
 * complete shader module that draws a screen-filling quad with UVs in
 * `VertexOutput.uv` (location 0).
 *
 * Contract:
 *   - Issue `draw(6)` with no vertex buffer
 *   - Fragment input: `@location(0) uv: vec2f`
 *   - UV origin: top-left, Y flipped from clip space
 */
export const FULLSCREEN_QUAD_WGSL = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}
`
