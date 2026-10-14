/**
 * Steps told as a comic strip: numbered ink panels, each with its own little
 * scene, the title and the copy beneath.
 */
export function Storyboard({
  steps,
  panels,
}: {
  steps: readonly { title: string; body: string }[];
  panels: readonly React.ReactNode[];
}): React.JSX.Element {
  return (
    <ol className={`storyboard${steps.length > 3 ? ' is-long' : ''}`}>
      {steps.map((step, i) => (
        <li key={step.title}>
          {panels[i]}
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </li>
      ))}
    </ol>
  );
}
