import type { ReactNode } from "react";

import "./opening-file.css";

export function OpeningFile({ action }: { action: ReactNode }) {
  return (
    <section
      id="opening-file"
      className="cafe-opening"
      aria-labelledby="opening-title"
    >
      <div className="cafe-opening-spread">
        <div className="cafe-opening-copy">
          <p className="cafe-kicker">For first-time café founders</p>
          <h1 id="opening-title">
            Open <br />
            <em>on paper.</em>
          </h1>
          <p className="cafe-opening-deck">
            Test your café before you sign the lease. Pick a spot, rehearse a
            Saturday rush, and see how many orders it takes to pay the rent.
          </p>
          {action}
        </div>
        <div className="cafe-opening-art">
          <span className="cafe-opening-clip" aria-hidden="true" />
          <figure className="cafe-opening-photo">
            <img
              src="/cafe/storefront-original.png"
              width={1672}
              height={941}
              alt="Vacant shop with a rust-orange awning and sunlight across the glass door"
            />
            <figcaption>Illustrative photograph</figcaption>
          </figure>
          <div className="cafe-opening-slip">
            <div className="cafe-opening-slip-label" aria-hidden="true">
              <b>OPENING FILE</b>
              <span>01</span>
            </div>
            <strong>One site. Two Saturdays.</strong>
            <p>Same arrivals · One change at a time</p>
          </div>
        </div>
      </div>
    </section>
  );
}
