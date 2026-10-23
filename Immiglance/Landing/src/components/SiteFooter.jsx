import { Link } from "react-router-dom";

// The bottom of every public Landing page: the two legal pages and the copyright line.
export default function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 py-8 space-y-4 text-sm text-muted-foreground">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>A case evaluation &amp; client portal platform.</span>
          <nav aria-label="Legal" className="flex items-center gap-5">
            <Link to="/privacy-policy" className="hover:text-foreground hover:underline">Privacy Policy</Link>
            <Link to="/terms-and-conditions" className="hover:text-foreground hover:underline">Terms &amp; Conditions</Link>
          </nav>
        </div>
        <p className="text-center sm:text-left">
          &copy; {Math.max(2026, new Date().getFullYear())} Immiglance. All Rights Reserved. Developed by{" "}
          <a href="https://embtelsolutions.com/" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline">
            Embtel Solutions, Inc
          </a>
        </p>
      </div>
    </footer>
  );
}
