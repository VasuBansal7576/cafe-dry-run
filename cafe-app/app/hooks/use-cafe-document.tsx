import { cafeDocuments, type CafeDocument } from "@shared/screen-navigation";
import { createContext, useCallback, useContext, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useLocation } from "react-router";

export { cafeDocuments, type CafeDocument };

type ScrollDocument = { locationKey: string; document: CafeDocument };

const CafeDocumentContext = createContext<
  [ScrollDocument | null, Dispatch<SetStateAction<ScrollDocument | null>>]
>([null, () => {}]);

export function CafeDocumentProvider({ children }: { children: ReactNode }) {
  const scrollDocument = useState<ScrollDocument | null>(null);
  return (
    <CafeDocumentContext.Provider value={scrollDocument}>
      {children}
    </CafeDocumentContext.Provider>
  );
}

export function useCafeDocument() {
  const { hash, key } = useLocation();
  const [scrolled, setScrolled] = useContext(CafeDocumentContext);
  const document =
    scrolled?.locationKey === key
      ? scrolled.document
      : cafeDocuments.find((name) => `#${name}` === (hash || "#opening-file"));
  const reportScroll = useCallback(
    (visible: CafeDocument) => {
      setScrolled((previous) =>
        previous?.locationKey === key && previous.document === visible
          ? previous
          : { locationKey: key, document: visible },
      );
    },
    [key, setScrolled],
  );
  return { document, reportScroll };
}
