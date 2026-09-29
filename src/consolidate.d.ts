declare module "@ladjs/consolidate" {
  type Render = (path: string, context: Record<string, unknown>) => Promise<string>;
  const consolidate: Record<string, Render | undefined>;
  export default consolidate;
}
