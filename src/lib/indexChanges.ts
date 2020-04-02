import { ArrayDelta } from "../delta";
import { SkipList } from "./SkipList";
import { sort } from "./algorithms";

//todonext;
//  Oh wait... for our index delta problem... we can just keep track of our array of changes as ranges,
//  and then apply them to a list of unchanged ranges (starting as everything). Deletes split ranges,
//      and insertions add new ranges that are marked as changed.
//  And then the unchanged ranges can store "original index", and just by iterating over the final range list we can
//  get "prev index". And then inverting the unchanged ranges will give us changed ranges...
//  - And moves with auxOrder would be easy to calculate, we just keep track of the values in auxStack, and then
//      take them out as we use them.
//      - Then add a TODO to support values being removed, and then added, in such a way that they don't need to be added or removed
//          anymore... it is hard, and we will probably never support it, but... if LongestSequence ever supports ranges,
//          we might do it.


type ArrayMutation = {
    index: number;
    // If < 0 it means there was a deletion at the index, > 0 there was an insert. A set should be turned into
    //  a delete and then insertion.
    sizeDelta: number;
};

todonext;
// Test getChanges.

//todonext
// Actually... after we get getChanges working... we should do this. Basically, it just means that sumList is
//  maintained in realtime, so deletions can be tracked BEFORE the values are deleted, which lets us store
//  them in a sorted list that represents the auxStack correctly.
// TODO: We could probably use SkipList to store values in an array (which allows lookup by index, and is fast to update),
//  and then with this we could store all the indexes of values from the original array, so we could get the original indexes
//  from our deletions (which is otherwise hard, because sorting by the index at the time of deletion may be out of
//  order from the original index order, which is the order the deletions will be applied in with the delta)... which
//  would let us store a sorted list of the auxStack, which we could then use to map a Map, which would then let
//  us do moves as well.

/** Mutations should include deletes, inserts AND sets (and of course, in order they were originally applied). */
export function getChanges(arrayOriginalSize: number, mutations: ArrayMutation[]): ArrayDelta {
    type Range = {
        state: "unchanged"|"inserted";
        originalIndex: number;
    };
    type RangeIndex = {
        size: number;
    };

    let sumList = new SkipList<Range, RangeIndex>(
        (lhs, rhs) => ({ size: lhs.size + rhs.size }),
        (lhs, rhs) => lhs.sumBefore.size - rhs.sumBefore.size,
    );

    sumList.addNode({ state: "unchanged", originalIndex: 0 }, { size: arrayOriginalSize }, { size: 0 });

    let deletions: {
        originalIndex: number;
        size: number;
    }[] = [];

    for(let mutation of mutations) {
        if(mutation.index < 0) {
            throw new Error(`Index should not be before the start of the array`);
        }
        if(mutation.sizeDelta === 0) continue;
        if(mutation.sizeDelta > 0) {
            sumList.addNode({ state: "inserted", originalIndex: -1 }, { size: mutation.sizeDelta }, { size: mutation.index });
        } else {
            let deleteSize = -mutation.sizeDelta;
            let deleteStart = mutation.index;
            let deleteEnd = deleteStart + deleteSize;
            sumList.mutateSumRange(
                { size: deleteStart },
                { size: deleteSize },
                (valuesStart, values) => {
                    let outputValues: { sumIncluded: RangeIndex, value: Range }[] = [];

                    let indexStart = valuesStart?.size || 0;
                    if(indexStart > deleteStart) {
                        throw new Error(`Internal error, the mutation was before the first range matched, but the ranges should go to index 0, and the mutation should be at >= 0, so... this is impossible`);
                    }

                    if(values.length === 0) return outputValues;

                    // We only care about the first value, the size of the values, and then the last value.
                    let firstValue = values[0];
                    let indexEnd = indexStart + values.reduce((a, b) => a + b.sumIncluded.size, 0);
                    let lastValue = values[values.length - 1];

                    // Get the part before the delete.
                    if(indexStart < deleteStart) {
                        values.splice(0, -1);
                        // (Otherwise it is ===, and there is no before part)
                        let sizeKept = deleteStart - indexStart;
                        if(firstValue.value.state === "unchanged") {
                            outputValues.push({ sumIncluded: { size: sizeKept }, value: { state: "unchanged", originalIndex: firstValue.value.originalIndex } });
                            deletions.push({ originalIndex: firstValue.value.originalIndex + sizeKept, size: firstValue.sumIncluded.size - sizeKept });
                        } else {
                            outputValues.push({ sumIncluded: { size: sizeKept }, value: { state: "inserted", originalIndex: -1 } });
                        }
                    }

                    if(deleteEnd < indexEnd) {
                        values.splice(-1, -1);
                        let sizeKept = indexEnd - deleteEnd;
                        if(firstValue.value.state === "unchanged") {
                            outputValues.push({ sumIncluded: { size: sizeKept }, value: { state: "unchanged", originalIndex: firstValue.value.originalIndex + firstValue.sumIncluded.size - sizeKept } });
                            deletions.push({ originalIndex: firstValue.value.originalIndex, size: firstValue.sumIncluded.size - sizeKept });
                        } else {
                            outputValues.push({ sumIncluded: { size: sizeKept }, value: { state: "inserted", originalIndex: -1 } });
                        }
                    }

                    // Middle values
                    for(let value of values) {
                        if(value.value.state === "unchanged") {
                            deletions.push({ originalIndex: value.value.originalIndex, size: value.sumIncluded.size });
                        }
                    }

                    return outputValues;
                }
            );
        }
    }

    let delta: ArrayDelta = {
        auxOrder: [],
        inserts: [],
        removes: [],
    };
    //todonext;
    // Ugh... wait... this is... we need the indexes of the original ranges, the unchanged ranges changed?
    //  Uh... and then we can infer the deletes (everything not unchanged), and inserts (everything changed, indexes from summing the sizes).
    //  And... we could make a lookup for the deletes and inserts, keeping track of the aux positions, and then pulling
    //  them out when iterating over the inserts, to create an auxOrder.
    let finalRanges = sumList.getAllNodes();
    let curIndex = 0;
    for(let range of finalRanges) {
        let size = range.sumIncluded.size;
        if(range.value.state === "inserted") {
            for(let i = 0; i < size; i++) {
                delta.inserts.push(curIndex + i);
            }
        }
        curIndex += size;
    }

    for(let deleteRange of deletions) {
        let { originalIndex, size } = deleteRange;
        for(let i = originalIndex; i < originalIndex + size; i++) {
            delta.removes.push(i);
        }
    }

    sort(delta.removes, x => -x);
    sort(delta.inserts, x => x);    

    return delta;
}

// //todonext;
// // OH! Maybe... we can just mark ranges as being touched, and then... do a sorting algorithm to find the
// //  transformations? It would work a lot better for primitive arrays, where values are duplicated a lot...

// //todonext
// // Oh course... I think we still need some kind of structure to keep track of the ranges that are touched,
// //  because after the first change indexes change, so the splice arguments are no longer correct

// //todonext;
// // Okay, index change tracker
// //  It is a tree, that stores size ranges by prev index. So it has ranges, that specify { prevIndex; prevSize; newSize; }
// //  These are put in a tree, where the parent nodes just summarize the child nodes, everything storted by prevIndex.
// //  The tree doesn't store curIndex, BUT, if you iterate through all of the nodes before a node, summing up size deltas,
// //      and then adding that to the prevIndex of that node, you will get the curIndex. Which can then be used to find the range
// //      that is before/ontopof any curIndex, which then tells you the prevIndex
// //      - Well... if it is a delete, then the prevIndex is gone, or rather there is no prevIndex
// //      - If there was an insert, then there is no prevIndex
// //      - But I guess knowing there is an overlap is useful too.

// // Oh, uh... well... I GUESS we can just take the first matching values... yeah... but then add a TODO about implementing
// //  this with a delta sort, because with a lot of changes it really is a lot more efficient, and if EVERYTHING changes
// //  then it might be as fast as LongestSequence, which would be nice (although... keeping track of the tree would
// //  probably make the overall algorithm slower again...)
// //  - And move this to a different file



// interface IndexTreeSummaryNode {
//     childSumSize: number;
//     children: IndexTreeSummaryNode[] | IndexTreeLeaf[];
// }
// type IndexTreeLeaf = {
//     // Not absolute, relative. Says the index offset we have compared to the previous unchanged range.
//     //  As in, there might have been elements before us, so while our our new array our first element may have an index of N, and the
//     //  previous unchanged group has an index of N - 1, if there were deletions between us then our original index might be much higher.
//     //  This is the changed index, so to go from curIndex => newIndex we have to SUBTRACT this value.
//     //  A value < 0 means our original index was higher, but values were deleted before us.
//     //  A value > 0 means there are elements before us that were inserted.
//     //  A value === 0 should be merged with the previous group, so can only exist in the first node
//     indexBeforeChange: number;
//     unchangedElementsSize: number;
// }
// function isLeaf(children: IndexTreeSummaryNode[] | IndexTreeLeaf[]): children is IndexTreeLeaf[] {
//     return children.length === 0 || !("childSumSize" in children[0]);
// }

// const summaryChildrenLimit = 2;
// const leafChildrenLimit = 2;

// // Mutates the range, assuming indexes are relative to the start of the given node
// function addMutatedIndexRange(
//     node: IndexTreeSummaryNode,
//     curIndex: number,
//     indexChange: number
// // Returns the amount that STILL needs to be removed from unchangedElementSize of children after this node
// ): number {
//     if(curIndex < 0) {
//         throw new Error(`Tried to mutate before the start of the array`);
//     }

//     node.childSumSize += indexChange;

//     let { children } = node;
//     if(!isLeaf(children)) {
//         // Try to add to existing problems, adding to the last one if we are at our children limit
//         let curChildIndex = 0;
//         for(let i = 0; i < children.length; i++) {
//             let child = children[i];
//             let curChildIndexEnd = curChildIndex + child.childSumSize;
//             if(
//                 curIndex < curChildIndexEnd
//                 // THIS skews towards adding towards the end. Classic balancing problem... but it shouldn't be too much of an issue
//                 || children.length >= summaryChildrenLimit && i === children.length - 1
//             ) {
//                 let indexChangedRemaining = addMutatedIndexRange(child, curIndex - curChildIndex, indexChange);
//                 if(indexChangedRemaining === 0) {
//                     return 0;
//                 }
//                 indexChange = indexChangedRemaining;
//                 curIndex = curChildIndexEnd;
//             }
//             curChildIndex = curChildIndexEnd;
//         }
//         if(indexChange < 0) {
//             // Must remove from cousins
//             return indexChange;
//         }
//         if(curIndex > curChildIndex) {
//             throw new Error(`Tried to mutate beyond the end of the array`);
//         }
//         // Add a new child
//         children.push({
//             childSumSize: Math.max(0, indexChange),
//             children: []
//         });
//     } else {
//         let childrenTyped = children;

//         indexChange = insert() || 0;
//         function insert() {
//             let children = childrenTyped;

//             let curChildIndex = 0;
//             for(let i = 0; i < children.length; i++) {
//                 let child = children[i];
//                 let curChildIndexEnd = curChildIndex + child.unchangedElementsSize;
//                 if(curIndex === curChildIndex) {
//                     if(indexChange < 0) {
//                         child.unchangedElementsSize -= indexChange;
//                         indexChange = 0;
//                         if(child.unchangedElementsSize < 0) {
//                             // Remove the child, and keep iterating (adjusting the index to account for our splice, of course)
//                             indexChange = child.unchangedElementsSize;
//                             children.splice(i, 1);
//                             i--;
//                             continue;
//                         }
//                     }
//                     child.indexBeforeChange += indexChange;
//                     return;
//                 }
//                 if(
//                     curIndex < curChildIndexEnd
//                     // THIS skews towards adding towards the end.
//                     || children.length >= leafChildrenLimit && i === children.length - 1
//                 ) {
//                     // Split the node
//                     let leftOverUnchanged = curChildIndexEnd - curIndex;
//                     child.unchangedElementsSize -= leftOverUnchanged;
//                     if(indexChange < 0) {
//                         leftOverUnchanged += indexChange;
//                         indexChange = 0;
//                         if(leftOverUnchanged < 0) {
//                             indexChange = leftOverUnchanged;
//                             continue; 
//                         }
//                     }
//                     if(leftOverUnchanged > 0) {
//                         children.splice(i + 1, 0, {
//                             indexBeforeChange: indexChange,
//                             unchangedElementsSize: leftOverUnchanged,
//                         });
//                     }
//                     return;
//                 }
//                 curChildIndex = curChildIndexEnd;
//             }
//             if(indexChange < 0) {
//                 // Must remove from cousins
//                 return indexChange;
//             }
//             if(curIndex > curChildIndex) {
//                 throw new Error(`Tried to mutate beyond the end of the array`);
//             }
//             // Add to the end.
//             if(children.length > 0 && children[children.length - 1].unchangedElementsSize === 0) {
//                 children[children.length - 1].indexBeforeChange += indexChange;
//             } else {
//                 children.push({
//                     indexBeforeChange: indexChange,
//                     unchangedElementsSize: 0,
//                 });
//             }
//         }

//         if(children.length > leafChildrenLimit) {
//             let splitPoint = ~~(children.length / 2);
//             let newChildren: IndexTreeSummaryNode[] = [];
//             splitChildOff(0, splitPoint);
//             splitChildOff(splitPoint, children.length);
//             node.children = newChildren;
//             function splitChildOff(indexStart: number, indexEnd: number) {
//                 let node = {
//                     childSumSize: 0,
//                     children: [] as IndexTreeLeaf[],
//                 };
//                 let children = childrenTyped;
//                 for(let i = indexStart; i < indexEnd; i++) {
//                     let child = children[i];
//                     node.childSumSize += child.unchangedElementsSize;
//                     node.children.push(child);
//                 }
//                 newChildren.push(node);
//             }
//         }
//     }
    
//     return indexChange;
// }

// export class IndexTree {
//     constructor(private size: number) { }
//     private root: IndexTreeSummaryNode = {
//         childSumSize: this.size,
//         children: [
//             { indexBeforeChange: 0, unchangedElementsSize: this.size }
//         ]
//     };

//     public mutateIndexRange(
//         curIndex: number,
//         changeCount: number,
//     ) {
//         addMutatedIndexRange(this.root, curIndex, changeCount);
//     }

//     public getMutatedRanged(): {
//         removed: {
//             originalIndex: number;
//             size: number
//         }[];
//         added: {
//             newIndex: number;
//             size: number;
//         }[];
//     } {
//         todonext;
//         // Now iterate through the tree, inferring the changes from the values that haven't changed.
//         //  Shouldn't be so hard...
//         //  Oh, and then we will be using our new Map<Value, { list: number[]; nextIndex: number; }> type thing
//         //  to find indexes after that, so we should take that code out of GetCurArrayDelta and share it.

//         todonext;
//         // Oh, uh... skip lists. But I don't know how to implement those, so really just tiers of lists held
//         //  in a global location. Oh, and each node will have to hold a reference to the corresponding one
//         //  on the next lower list. Hmm... okay, well... so we have linked lists. Eh... that's not so bad...
//         // Parts:
//         //  - Ability to reduce summary nodes to... final summary?
//         //  - Ability to compare leaf nodes to summary nodes, to tell which side we should go to.
//         //  - Ability to convert leaf node to summary node
//         //  - Ability to reduce summary nodes to another summary node (maybe have no final summary node).
//         // Exposes:
//         //  - Search by leaf node? AND/OR summary node?
//         //  - Iterate on leaf nodes, with summary at each node?
//         //      - Or do we even need summary at each node? I think the biggest thing is just ordering them.


//         todonext;
//         // Hmm... thinking about it more... we might actually want to add DOM matching within our removed/inserted groups,
//         //  in mount2, after they are calculated? Because a user might remove an object, and then add a very similar one,
//         //  in which case it might be efficient to reuse it, however right now we won't, even if the keys match.
//         //  - Yeah, shouldn't be so hard... we will have to take that code from our expandShell code, or something...
//         return null as any;
//     }
// }
