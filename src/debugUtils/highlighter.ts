export type QueryObject = {
    /** If it is a QueryObject (instead of just a string), we match it with wildcards between all the letters,
     *      ignore spaces, and do a lowercase match.
     */
    query: string;
}
export interface KeyMatchHighlight {
    parts: ({
        matched: boolean;
        key: string;
    })[];
}

// If there is a root level QueryObject we match against the path hash. This means we will add a lot of spaces and dots
//  to the string, and possible match those. We will try to remove those for the highlight, so it shouldn't be noticeable,
//  except by the fact that attempting to actually match dots (spaces can't be matched anyway) will instead match
//  the dots we add, which may match more or fewer paths than expected, and won't appear in the highlight.
export type PathQuery = (PropertyKey | QueryObject)[] | QueryObject;

export function getMatchQuery(query: string, textParts: string[], withHighlight: true): KeyMatchHighlight[]|undefined;
export function getMatchQuery(query: string, textParts: string[], withHighlight: false): true|undefined;
export function getMatchQuery(query: string, textParts: string[], withHighlight: boolean): true|KeyMatchHighlight[]|undefined {
    if(query.length === 0) return textParts.map(() => ({ parts: [] }));
    if(textParts.length === 0) return undefined;

    query = query.toLowerCase().replace(/ /g, "");

    let highlights!: KeyMatchHighlight[];

    // Run it twice, once to check if we match, the second time to pick up the highlight if we matched.
    //  (Running it once will result in creating a lot of partial highlight, and then destroying them, which
    //  makes the whole algorithm a lot slower).
    if(getInner(false)) {
        if(!withHighlight) return true;
        highlights = [];
        getInner(true);
        return highlights;
    }

    return undefined;

    function getInner(getHighlight: boolean): boolean {
        let iText = 0;
        let iiText = 0;
        let text = textParts[iiText].toLowerCase();

        let highlight!: KeyMatchHighlight;
        if(getHighlight) {
            highlight = { parts: [] };
        }
        let pending = "";
        let pendingState = false;
        function popPending() {
            if(pending) {
                highlight.parts.push({
                    key: pending,
                    matched: pendingState,
                });
            }
            pending = "";
            pendingState = !pendingState;
        }

        for(let i = 0; i < query.length; i++) {
            let ch = query[i];
            while(true) {
                while(iiText < textParts.length && iText >= text.length) {
                    iiText++;
                    if(getHighlight) {
                        popPending();
                        highlights.push(highlight);
                        highlight = { parts: [] };
                    }
                    if(iiText >= textParts.length) return false;
                    text = textParts[iiText].toLowerCase();
                    iText = 0;
                }

                let matched = ch === text[iText];
                if(getHighlight) {
                    if(matched !== pendingState) {
                        popPending();
                    }
                    pending += text[iText];
                }
                iText++;
                if(matched) {
                    break;
                }
            }
        }

        if(getHighlight) {
            popPending();
        }
        if(getHighlight) {
            highlights.push(highlight);
        }
        return true;
    }
}

// Highlight is in parallel with the pathForQuery of the element.

export function getHighlight(query: PathQuery, path: readonly PropertyKey[], withHighlight: true): KeyMatchHighlight[] | undefined;
export function getHighlight(query: PathQuery, path: readonly PropertyKey[], withHighlight: false): true | undefined;
export function getHighlight(query: PathQuery, path: readonly PropertyKey[], withHighlight: boolean): true | KeyMatchHighlight[] | undefined {
    if(!Array.isArray(query)) {
        return getMatchQuery(query.query, path.map(x => String(x)), withHighlight as any);
    } else {
        if(path.length !== query.length) {
            return undefined;
        }
        let highlights: KeyMatchHighlight[] = [];
        for(let i = 0; i < query.length; i++) {
            let queryPart = query[i];
            let text = path[i];
            if(typeof queryPart === "object") {
                let highlight = getMatchQuery(queryPart.query, [String(text)], withHighlight as any);
                if(!highlight) return undefined;
                if(withHighlight) {
                    highlights.push(highlight[0]);
                }
            } else {
                if(queryPart !== text) {
                    return undefined;
                }
                highlights.push({ parts: [{ key: String(queryPart), matched: true }] });
            }
        }
        if(!withHighlight) return true;
        return highlights;
    }
}