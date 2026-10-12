import { COPY } from "@/lib/copy";
import Scout from "./scout";

export default function Home() {
  return (
    <main>
      <header>
        <h1>{COPY.TITLE}</h1>
        <p className="muted subtitle">{COPY.SUBTITLE}</p>
      </header>
      <Scout />
      <footer>
        <p>
          <a href="https://www.producthunt.com" target="_blank" rel="noopener noreferrer">
            {COPY.FOOT_ATTR}
          </a>
        </p>
        <p className="muted">{COPY.FOOT_NOTE}</p>
      </footer>
    </main>
  );
}
