import { Suspense } from "react";

// The public legal pages, the data notice (P11) and the terms of service (P12):
// one document per language, chosen by ?lang=ko, with a link to the other
// language. Each page module keeps its own text so its claims sit beside one file.

export type LegalSection = {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly items?: readonly string[];
  readonly links?: readonly { readonly href: string; readonly label: string }[];
};

export type LegalDocument = {
  readonly lang: "en" | "ko";
  readonly title: string;
  readonly updated: string;
  readonly intro: string;
  readonly other: { readonly href: string; readonly label: string };
  readonly sections: readonly LegalSection[];
};

export type LegalSearchParams = Promise<{ lang?: string | string[] }>;

// The language comes from the request, so the document renders inside Suspense.
export function LegalPage(props: { readonly en: LegalDocument; readonly ko: LegalDocument; readonly searchParams: LegalSearchParams }) {
  return (
    <Suspense fallback={<p className="sr-only" role="status">Loading...</p>}>
      <DocumentPage {...props} />
    </Suspense>
  );
}

async function DocumentPage({ en, ko, searchParams }: { readonly en: LegalDocument; readonly ko: LegalDocument; readonly searchParams: LegalSearchParams }) {
  const { lang } = await searchParams;
  const content = lang === "ko" ? ko : en;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-16 sm:px-8" lang={content.lang}>
      <header className="flex flex-col gap-3">
        <p className="text-sm">
          <a className="underline underline-offset-4" href="/">
            Find Me a Time
          </a>
          {" · "}
          <a className="underline underline-offset-4" href={content.other.href} hrefLang={content.lang === "en" ? "ko" : "en"}>
            {content.other.label}
          </a>
        </p>
        <h1 className="font-display text-[clamp(32px,5vw,48px)] leading-tight">{content.title}</h1>
        <p className="text-muted-foreground text-sm">{content.updated}</p>
        <p className="text-lg">{content.intro}</p>
      </header>
      {content.sections.map((section) => (
        <section aria-labelledby={`${section.id}-heading`} className="flex scroll-mt-8 flex-col gap-3" id={section.id} key={section.id}>
          <h2 className="font-display text-2xl" id={`${section.id}-heading`}>
            {section.title}
          </h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.items ? (
            <ul className="flex list-disc flex-col gap-2 pl-5">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {section.links ? (
            <ul className="flex flex-col gap-1">
              {section.links.map((link) => (
                <li key={link.href}>
                  <a className="underline underline-offset-4" href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </main>
  );
}
