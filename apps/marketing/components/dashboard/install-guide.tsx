'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { CopyButton } from './kit.js';

/**
 * How to paste the install snippet, one tab per kind of website. The snippet is
 * the same everywhere; what differs is where each platform keeps "custom code",
 * and the plan or setting that quietly stops it running.
 */

interface Block {
  label: string;
  code: string;
  copy: string;
}

interface Platform {
  key: string;
  name: string;
  steps: ReactNode[];
  code: Block[];
  notes?: ReactNode[];
}

/** The pieces of the snippet, for platforms that want them in their own syntax. */
function snippetParts(snippet: string): { src: string; widgetId: string; apiUrl: string } | null {
  const src = /src="([^"]+)"/.exec(snippet)?.[1];
  const widgetId = /data-widget-id="([^"]+)"/.exec(snippet)?.[1];
  const apiUrl = /data-api-url="([^"]+)"/.exec(snippet)?.[1];
  return src && widgetId && apiUrl ? { src, widgetId, apiUrl } : null;
}

function platforms(snippet: string): Platform[] {
  const parts = snippetParts(snippet);
  const nextScript = parts
    ? `import Script from 'next/script';\n\n` +
      `// In app/layout.tsx, inside <body>:\n` +
      `<Script\n` +
      `  src="${parts.src}"\n` +
      `  data-widget-id="${parts.widgetId}"\n` +
      `  data-api-url="${parts.apiUrl}"\n` +
      `  strategy="afterInteractive"\n` +
      `/>`
    : snippet;
  const wordpressPhp =
    `add_action( 'wp_footer', function () {\n` +
    `    ?>\n` +
    snippet
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n') +
    `\n    <?php\n} );`;

  return [
    {
      key: 'html',
      name: 'Any website',
      steps: [
        <>
          Open the HTML of your site&rsquo;s shared template or footer, the file every page uses.
        </>,
        <>
          Paste the snippet just before <code>&lt;/body&gt;</code>.
        </>,
        <>Upload or publish the change.</>,
      ],
      code: [{ label: 'Install snippet', code: snippet, copy: 'Copy snippet' }],
      notes: [
        <>
          If your site has no shared template, paste it before <code>&lt;/body&gt;</code> on every
          page where Sunny should appear.
        </>,
      ],
    },
    {
      key: 'wordpress',
      name: 'WordPress',
      steps: [
        <>
          In WordPress admin, go to <strong>Plugins → Add New</strong>, search for{' '}
          <strong>WPCode</strong> (&ldquo;Insert Headers and Footers by WPCode&rdquo;), then install
          and activate it.
        </>,
        <>
          Go to <strong>Code Snippets → Header &amp; Footer</strong>.
        </>,
        <>
          Paste the snippet into the <strong>Footer</strong> box and click{' '}
          <strong>Save Changes</strong>.
        </>,
        <>Clear your site&rsquo;s cache, then open it in a private window to check.</>,
      ],
      code: [
        { label: 'Install snippet', code: snippet, copy: 'Copy snippet' },
        {
          label: 'Or, for developers: a child theme’s functions.php',
          code: wordpressPhp,
          copy: 'Copy PHP',
        },
      ],
      notes: [
        <>
          Don&rsquo;t use a Custom HTML block on a page: Sunny would only appear on that one page.
        </>,
        <>
          Caching and speed plugins (WP Rocket, LiteSpeed, Autoptimize, Perfmatters): add{' '}
          <code>sunny-widget.js</code> to their &ldquo;delay JavaScript&rdquo; and &ldquo;combine
          JavaScript&rdquo; exclusions. Turn off Cloudflare Rocket Loader for it too.
        </>,
        <>
          WordPress.com (hosted) sites need the Business plan or higher to add scripts. Self-hosted
          WordPress has no such limit.
        </>,
        <>
          Put the PHP version in a child theme only. A theme update overwrites the parent
          theme&rsquo;s files.
        </>,
      ],
    },
    {
      key: 'wix',
      name: 'Wix',
      steps: [
        <>
          In your Wix dashboard, go to <strong>Settings → Custom Code</strong> (under Advanced).
        </>,
        <>
          Click <strong>+ Add Custom Code</strong> and paste the snippet.
        </>,
        <>
          Name it &ldquo;Sunny&rdquo;, choose <strong>All pages</strong> and{' '}
          <strong>Load code once</strong>.
        </>,
        <>
          Under <strong>Place Code in</strong>, choose <strong>Body - end</strong>, then click{' '}
          <strong>Apply</strong>.
        </>,
      ],
      code: [{ label: 'Install snippet', code: snippet, copy: 'Copy snippet' }],
      notes: [
        <>
          Wix only runs custom code on a premium plan with a connected domain. It does not run in
          the Wix editor preview: check the live site.
        </>,
      ],
    },
    {
      key: 'squarespace',
      name: 'Squarespace',
      steps: [
        <>
          Open <strong>Code Injection</strong>. The quickest way is to type &ldquo;Code
          Injection&rdquo; into the search in your Squarespace dashboard.
        </>,
        <>
          Paste the snippet into the <strong>Footer</strong> box.
        </>,
        <>
          Click <strong>Save</strong>.
        </>,
      ],
      code: [{ label: 'Install snippet', code: snippet, copy: 'Copy snippet' }],
      notes: [
        <>
          Code Injection needs a Core plan or higher (Business on older plans). It doesn&rsquo;t run
          while you&rsquo;re signed in and editing: check the site in a private window.
        </>,
      ],
    },
    {
      key: 'shopify',
      name: 'Shopify',
      steps: [
        <>
          In Shopify admin, go to <strong>Online Store → Themes</strong>.
        </>,
        <>
          On your current theme, click <strong>…</strong> then <strong>Edit code</strong>.
        </>,
        <>
          Open <code>layout/theme.liquid</code> and paste the snippet just before{' '}
          <code>&lt;/body&gt;</code>.
        </>,
        <>
          Click <strong>Save</strong>.
        </>,
      ],
      code: [{ label: 'Install snippet', code: snippet, copy: 'Copy snippet' }],
      notes: [
        <>
          Changing or updating your theme replaces <code>theme.liquid</code>: paste the snippet
          again afterwards.
        </>,
        <>
          To preview on your <code>myshopify.com</code> address, add that address (for example{' '}
          <code>yourstore.myshopify.com</code>) to your website domains as well.
        </>,
      ],
    },
    {
      key: 'webflow',
      name: 'Webflow',
      steps: [
        <>
          Open your project&rsquo;s <strong>Site settings → Custom code</strong>.
        </>,
        <>
          Paste the snippet into <strong>Footer code</strong> and click <strong>Save</strong>.
        </>,
        <>
          <strong>Publish</strong> the site. Custom code only runs on the published site.
        </>,
      ],
      code: [{ label: 'Install snippet', code: snippet, copy: 'Copy snippet' }],
      notes: [
        <>
          Site-wide custom code needs a paid Webflow site plan. To preview on your{' '}
          <code>webflow.io</code> address, add it to your website domains as well.
        </>,
      ],
    },
    {
      key: 'gtm',
      name: 'Google Tag Manager',
      steps: [
        <>
          In your container, go to <strong>Tags → New</strong> and choose{' '}
          <strong>Custom HTML</strong>.
        </>,
        <>Paste the snippet.</>,
        <>
          Set the trigger to <strong>All Pages</strong> (or{' '}
          <strong>Initialization - All Pages</strong>) and save the tag.
        </>,
        <>
          Click <strong>Submit</strong>, then <strong>Publish</strong>.
        </>,
      ],
      code: [{ label: 'Install snippet', code: snippet, copy: 'Copy snippet' }],
      notes: [
        <>
          If a cookie banner holds Tag Manager tags until consent, Sunny waits for it too. Mark the
          tag as functional if you want Sunny there from the first page view.
        </>,
      ],
    },
    {
      key: 'react',
      name: 'React and Next.js',
      steps: [
        <>
          <strong>Next.js:</strong> add the <code>Script</code> below to your root layout, inside{' '}
          <code>&lt;body&gt;</code>, and deploy.
        </>,
        <>
          <strong>Any other React app</strong> (Vite, Create React App): paste the plain snippet
          into <code>index.html</code>, just before <code>&lt;/body&gt;</code>.
        </>,
      ],
      code: [
        { label: 'Next.js', code: nextScript, copy: 'Copy Next.js code' },
        { label: 'Other React apps: index.html', code: snippet, copy: 'Copy snippet' },
      ],
      notes: [
        <>
          Load it once, in the layout, not inside a page component: Sunny stays open as visitors
          move between pages.
        </>,
      ],
    },
  ];
}

/** Arrow keys move between tabs (the WAI-ARIA tabs pattern, automatic activation). */
function nextIndex(key: string, at: number, count: number): number | null {
  if (key === 'ArrowRight') return (at + 1) % count;
  if (key === 'ArrowLeft') return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export function InstallGuide({
  snippet,
  domains,
  domainsLink,
}: {
  snippet: string;
  domains: string[];
  /** Where the website domains are changed: a page, or a #fragment on this one. */
  domainsLink: string;
}) {
  const list = platforms(snippet);
  const [selected, setSelected] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const current = list[selected]!;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const next = nextIndex(event.key, selected, list.length);
    if (next === null) return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }

  // A link on the same page names the field; one to another page names that page too.
  const where = (
    <a href={domainsLink}>
      {domainsLink.startsWith('#') ? 'Website domains, below' : 'Settings → Website domains'}
    </a>
  );

  return (
    <div className="install-guide">
      <p className="muted card-lead">
        {domains.length > 0 ? (
          <>
            Sunny only opens on <strong>{domains.join(', ')}</strong> and their subdomains. Using
            another address? Add it in {where}.
          </>
        ) : (
          <>
            Add your website&rsquo;s domain in {where} first: Sunny refuses to open on any site that
            isn&rsquo;t listed.
          </>
        )}
      </p>
      <div
        className="install-tabs"
        role="tablist"
        aria-label="Your website platform"
        onKeyDown={onKeyDown}
      >
        {list.map((platform, index) => (
          <button
            key={platform.key}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${platform.key}`}
            aria-selected={index === selected}
            aria-controls={`${id}-panel`}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => setSelected(index)}
          >
            {platform.name}
          </button>
        ))}
      </div>
      <div
        className="install-panel"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${current.key}`}
        tabIndex={0}
      >
        <ol className="install-steps">
          {current.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
        {current.code.map((block) => (
          <div className="install-code" key={block.label}>
            <p className="install-code-label">{block.label}</p>
            <pre className="snippet" aria-label={block.label}>
              {block.code}
            </pre>
            <div className="actions">
              <CopyButton text={block.code} label={block.copy} />
            </div>
          </div>
        ))}
        {current.notes ? (
          <ul className="install-notes">
            {current.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
