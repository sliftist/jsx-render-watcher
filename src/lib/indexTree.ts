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
