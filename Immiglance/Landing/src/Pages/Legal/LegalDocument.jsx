import { useEffect } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import SiteFooter from "../../components/SiteFooter";

// Shared layout of the two legal pages: title, effective date, a contents list, then the numbered sections.
// A section is { id, title, paragraphs?: string[], items?: string[], notes?: [{ label, text }] } - plain text only.
export default function LegalDocument({ title, effective, intro, sections, other }) {
  useEffect(() => {
    document.title = `${title} | Immiglance`;
    window.scrollTo(0, 0);
  }, [title]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-5 sm:px-6 py-12 text-foreground">
          <header className="mb-8 border-b border-border pb-6">
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Immiglance &middot; Effective date: {effective}</p>
            {intro.map((text) => <p key={text.slice(0, 40)} className="mt-4 leading-relaxed text-foreground/90">{text}</p>)}
          </header>

          <nav aria-label="Contents" className="mb-10 rounded-lg border border-border bg-muted/30 p-5">
            <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Contents</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {sections.map((section) => (
                <li key={section.id}><a href={`#${section.id}`} className="text-primary hover:underline">{section.title}</a></li>
              ))}
            </ol>
          </nav>

          <div className="space-y-9">
            {sections.map((section, index) => (
              <section key={section.id} id={section.id} className="scroll-mt-24">
                <h2 className="mb-3 text-xl font-semibold">{index + 1}. {section.title}</h2>
                {(section.paragraphs || []).map((text) => <p key={text.slice(0, 50)} className="mb-3 leading-relaxed text-foreground/90">{text}</p>)}
                {section.items && (
                  <ul className="mb-3 list-disc space-y-1.5 pl-6 leading-relaxed text-foreground/90">
                    {section.items.map((item) => <li key={item.slice(0, 50)}>{item}</li>)}
                  </ul>
                )}
                {(section.notes || []).map((note) => (
                  <p key={note.label} className="mb-2 leading-relaxed text-foreground/90"><span className="font-semibold">{note.label}</span> {note.text}</p>
                ))}
              </section>
            ))}
          </div>

          <p className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
            Also see our <Link to={other.to} className="text-primary hover:underline">{other.label}</Link>.
          </p>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
