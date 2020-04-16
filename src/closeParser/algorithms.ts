/** Always returns the index of the first match in the list. */
export function binarySearch<T>(list: T[], value: T, comparer: (lhs: T, rhs: T) => number): number {
    if(!list) {
        debugger;
    }
    let minIndex = 0;
    let maxIndex = list.length;

    while (minIndex < maxIndex) {
        let fingerIndex = ~~((maxIndex + minIndex) / 2);
        // Try to increase the minIndex if the finger is in the middle
        if(minIndex + 2 === maxIndex) {
            fingerIndex = minIndex;
        }
        let finger = list[fingerIndex];
        let comparisonValue = comparer(value, finger);
        // Check the minIndex first
        if(comparisonValue > 0) {
            minIndex = fingerIndex + 1;
        } else if(comparisonValue < 0) {
            maxIndex = fingerIndex;
        } else {
            // Modification to keep searching until we get to the first element that matches.
            if(minIndex + 1 === maxIndex) {
                return fingerIndex;
            }
            maxIndex = fingerIndex + 1;
        }
    }
    return ~minIndex;
}