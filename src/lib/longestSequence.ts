import { binarySearch } from "./algorithms";

// TODO: Rewrite this to use some kind of sorting algorithm, which outputs the operations needed to sort the array starting in
//  previous order, to an array in the new order. This will allow many more cases than our current algorithm, and (if the sorting
//  algorithm is good), should always result in optimal dom transformations. Also, a sorting algorithm should be very fast
//  (depending on the algorithm choosen), hopefully faster LongestSequence is right now.

/** Gets the longest increasing sequence of elements in arr where every element has a higher newIndex and
 *      higher originalIndex then the previous element in the sequence
 *  (where new index is the value in the array, and original index is the index in the array).
 */
export function LongestSequence(arr: number[]): {
    //longestSequence: number[];
    // The remaining sequence values, not in the longest sequence
    otherSequence: number[];
} {
    if(arr.length === 0) {
        return {
            //longestSequence: [],
            otherSequence: [],
        };
    }

    // Longest sequence algorithm
    //  - Dynamic programming, every time we add a new element the longest sequence ending in that element
    //      will have some previously longest sequence ending in some element in front of it (including the empty sequence).
    //  - However, if we have two previous longest sequences of the same length, if we match the one with a higher last element,
    //      we always match the one with a smaller last element. So for each sequence length we might as well only store the
    //      sequence with a smaller last element.

    // Index + 1 is the length of the sequence, and number is the index in arr
    //  Also, it turns out the arr[index].index values are sorted in this array, somehow...
    let longestSequencesByLength: number[] = []
    
    // In the sequence where arr[index] is the last member, arr[prevSequenceIndex[index]] is the previous member,
    //  (unless prevSequenceIndex gives -1, then the longest sequence is over).
    let prevSequenceIndex: number[] = [];

    for(let i = 0; i < arr.length; i++) {
        let value = arr[i];

        // See if we extend any longest sequences
        // We can do a binary search, because longestSequenceByLength is sorted by value
        let insertIndex = binarySearch(longestSequencesByLength, i, (a, b) => arr[a] - arr[b]);
        if(insertIndex >= 0) {
            prevSequenceIndex.push(prevSequenceIndex[longestSequencesByLength[insertIndex]]);
            continue;
        }

        insertIndex = ~insertIndex;

        let previousIndexIndex = insertIndex - 1;
        if(previousIndexIndex >= 0) {
            prevSequenceIndex.push(longestSequencesByLength[previousIndexIndex]);
        } else {
            prevSequenceIndex.push(-1);
        }

        if(insertIndex >= longestSequencesByLength.length) {
            longestSequencesByLength.push(i);
        } else if(insertIndex < longestSequencesByLength.length) {
            let prevValue = arr[longestSequencesByLength[insertIndex]];
            if(value < prevValue) {
                longestSequencesByLength[insertIndex] = i;
            }
        }
    }

    let lastBestSeqIndex = longestSequencesByLength[longestSequencesByLength.length - 1];


    //let longestSequenceBackwards: number[] = [];
    let usedIndexes: Set<number> = new Set();
    while(lastBestSeqIndex !== -1) {
        //longestSequenceBackwards.push(lastBestSeqIndex);
        usedIndexes.add(lastBestSeqIndex);
        lastBestSeqIndex = prevSequenceIndex[lastBestSeqIndex];
    }

    let otherSequence: number[] = [];

    for(let i = 0; i < arr.length; i++) {
        if(usedIndexes.has(i)) continue;
        otherSequence.push(i);
    }
    //let longestSequence = longestSequenceBackwards.reverse();

    
    return {
        //longestSequence: longestSequence.map(x => arr[x]),
        otherSequence: otherSequence
    };
}