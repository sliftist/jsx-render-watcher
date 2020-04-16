// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

import { parse, AST_NODE_TYPES, simpleTraverse, visitorKeys } from "@typescript-eslint/typescript-estree";
import { Statement, LineAndColumnData, Program, IdentifierToken, Token, Node, SourceLocation, Identifier } from "@typescript-eslint/typescript-estree/dist/ts-estree/ts-estree";
import { binarySearch } from "./algorithms";
import { DeclObj, ScopeObj, parseClosed } from "./parseClosed";
import { EnterExitTraverser } from "./enterExitTraverser";


const decType = vscode.window.createTextEditorDecorationType;


const variableDeclaration = decType({});
const variableDeclarationUnused = decType({ backgroundColor: `hsla(320, 75, 40, 0)` });
const variableDeclarationHasCloses = decType({
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});
const variableDeclarationHasCloses0 = decType({
	before: {
		contentText: " ",
		backgroundColor: "hsla(280, 75%, 40%, 1)",
		width: "10px",
		height: "10px",
		margin: "0px 2px 0px 2px",
	},
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});
const variableDeclarationHasCloses1 = decType({
	before: {
		contentText: " ",
		backgroundColor: "hsla(60, 75%, 40%, 1)",
		width: "10px",
		height: "10px",
		margin: "0px 2px 0px 2px",
	},
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});
const variableDeclarationHasCloses2 = decType({
	before: {
		contentText: " ",
		backgroundColor: "hsla(200, 75%, 40%, 1)",
		width: "10px",
		height: "10px",
		margin: "0px 2px 0px 2px",
	},
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});
const variableDeclarationHasCloses3 = decType({
	before: {
		contentText: " ",
		backgroundColor: "hsla(0, 75%, 40%, 1)",
		width: "10px",
		height: "10px",
		margin: "0px 2px 0px 2px",
	},
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});
const variableDeclarationHasCloses4 = decType({
	before: {
		contentText: " ",
		backgroundColor: "hsla(0, 75%, 40%, 1)",
		width: "10px",
		height: "10px",
		margin: "0px 2px 0px 2px",
	},
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

// Order is order of matching precedence
const variableUsedGlobal = decType({
	border: "1px solid hsla(0, 0%, 70%, 0.4)",
	color: "hsla(0, 0%, 80%, 1)",
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});
const variableUsedSameScope = decType({ });
const variableUsedFunctionScope = decType({ });
const variableUsedRootScope = decType({
	border: "1px transparent",
	outline: "1px solid hsla(280, 75%, 40%, 0.6)",
	//backgroundColor: "blue",
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});
const variableUsedOtherScope0 = decType({
	border: "2px solid hsla(280, 75%, 40%, 0.4)",
	backgroundColor: "hsla(280, 75%, 40%, 0.3)",
	color: "hsla(280, 75%, 80%, 1)",
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});
const variableUsedOtherScope1 = decType({
	border: "2px solid hsla(60, 75%, 40%, 0.4)",
	backgroundColor: "hsla(60, 75%, 40%, 0.3)",
	color: "hsla(60, 75%, 80%, 1)",
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});
const variableUsedOtherScope2 = decType({
	border: "2px solid hsla(200, 75%, 40%, 0.4)",
	backgroundColor: "hsla(200, 75%, 40%, 0.3)",
	color: "hsla(200, 75%, 80%, 1)",
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});
const variableUsedOtherScope3 = decType({
	border: "2px solid hsla(0, 75%, 40%, 0.4)",
	backgroundColor: "hsla(0, 75%, 40%, 0.3)",
	color: "hsla(0, 75%, 80%, 1)",
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});
const variableUsedOtherScope4 = decType({
	border: "2px solid hsla(0, 75%, 40%, 1)",
	backgroundColor: "hsla(0, 75%, 40%, 0.6)",
	color: "hsla(0, 75%, 50%, 1)",
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});


function getVariableUsedOtherScope(index: number) {
	if(index === 0) return variableUsedOtherScope0;
	if(index === 1) return variableUsedOtherScope1;
	if(index === 2) return variableUsedOtherScope2;
	if(index === 3) return variableUsedOtherScope3;
	return variableUsedOtherScope4;
}

function getCloseColoring(index: number) {
	if(index === 0) return variableDeclarationHasCloses0;
	if(index === 1) return variableDeclarationHasCloses1;
	if(index === 2) return variableDeclarationHasCloses2;
	if(index === 3) return variableDeclarationHasCloses3;
	return variableDeclarationHasCloses4;
}

const fullDecorationsList = [
	variableDeclaration, variableDeclarationUnused, variableUsedGlobal, variableUsedSameScope, variableUsedFunctionScope, variableUsedRootScope,
	variableUsedOtherScope0, variableUsedOtherScope1, variableUsedOtherScope2, variableUsedOtherScope3, variableUsedOtherScope4
];


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	let status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);

	let recentRunLength = 10 * 1000;
	let recentRuns: { start: number; end: number }[] = [];
	function timeCode(code: () => void) {
		let runStart = Date.now();
		try {
			code();
		} finally {
			let runEnd = Date.now();
			recentRuns.push({ start: runStart, end: runEnd });
		}

		updateUsageFraction();
	}
	function updateUsageFraction() {
		let sum = 0;
		let threshold = Date.now() - recentRunLength;
		for(let i = recentRuns.length - 1; i >= 0; i--) {
			let run = recentRuns[i];
			if(run.start < threshold) {
				recentRuns.splice(i);
			}
			let time = run.end - run.start;
			sum += time;
		}
		let usageFrac = sum / recentRunLength;

		let lastTime = 0;
		if(recentRuns.length > 0) {
			lastTime = recentRuns[recentRuns.length - 1].end - recentRuns[recentRuns.length - 1].start;
		}

		status.text = `Close Parsing ${sum}ms/${recentRunLength}ms, ${recentRuns.length}, Last ${lastTime}ms`;
		status.show();
	}

	timeCode(() => activateBase(context, timeCode));


	
	context.subscriptions.push(status);
}
function activateBase(context: vscode.ExtensionContext, timeCode: (code: () => void) => void) {

	//todonext;
	// Hmm... it would be nice if we could distinguish between reads, writes and function calls.
	//	Becausing writing to a value in another scope is very different than writing to it.
	//	- Although, if they assign to a local variable and then modify it... we will no longer be
	//		able to determine the operation, so... maybe it isn't THAT useful.
	//		- Uh, but maybe at least for imported values, or globals? Those are significant if they
	//			are read or written to, as imports should probably only be called as a function?
	//todonext
	//	If we could change the autocomplete info, that would be great. It should really show the parent
	//		scope (the name of the function, or... something for for loops, for while loops, braces might
	//		need a path type info, like "call.for.brace", or something like that).

	// So... we should at least distinguish between globals, imports, and local, perhaps
	//	with a special case for top level module local, as... those are often safer to access from
	//	a deeply nested scope, as opposed to local 1 level down...



	let activeEditor = vscode.window.activeTextEditor;

	function updateDecorations() {
		if (!activeEditor) {
			return;
		}
		
		let doc = activeEditor.document;

		let { languageId } = doc;
		if(languageId !== "typescriptreact" && languageId !== "typescript") return;

		function getPos(pos: LineAndColumnData): vscode.Position {
			return new vscode.Position(pos.line - 1, pos.column);
		}
		
		let decorations: Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]> = new Map();
		function baseAddDecoration(type: vscode.TextEditorDecorationType, option: vscode.DecorationOptions) {
			let list = decorations.get(type);
			if(!list) {
				list = [];
				decorations.set(type, list);
			}
			list.push(option);
			return list;
		}
		function addDecoration(type: vscode.TextEditorDecorationType, range: vscode.Range, hoverMessage?: string, pointTo?: SourceLocation) {
			let option: vscode.DecorationOptions = {
				range: range,
				hoverMessage: hoverMessage,
			};
			
			baseAddDecoration(type, option);
		}

		function onDeclare(obj: DeclObj, scope: ScopeObj) {
			declarations.set(obj, new Set());
		}
		function onAccess(
			declScope: ScopeObj|undefined,
			varName: string,
			varPos: number,
			curScope: ScopeObj,
			curFncScope: ScopeObj,
			declObj: DeclObj|undefined,
		): void {
	
			let range = new vscode.Range(doc.positionAt(varPos), doc.positionAt(varPos + varName.length));
	
			if(!declScope) {					
				addDecoration(variableUsedGlobal, range, `Closed variable from global scope`);
				return;
			}
			if(!declObj) {
				throw new Error(`not declObj passed while there was a declScope passed. This is unexpected`);
			}
	
			let declFncScope = declScope.type === "brace" && declScope.parentFncScope || declScope;
			
			// Ugh, the root function/brace scopes means it might not be the same scope object. But... if the
			//	pos start is the same, it has to be the same scope... right?
			if(declScope.posStart === curScope.posStart) {
				addDecoration(variableUsedSameScope, range, `Closed variable from same scope`);
				return;
			} else if(declFncScope === curFncScope) {
				addDecoration(variableUsedFunctionScope, range, `Closed variable from function scope`);
				return;
			} else if(declScope.parentScope === undefined) {
				addDecoration(variableUsedRootScope, range, `Closed variable from module scope`);
				return;
			} else {
				let scopeName = declScope.scopeName;
	
				let functionScope = curScope.type === "function" ? curScope : curScope.parentFncScope;
	
				if(!functionScope) {
					throw new Error(`Internal error, if the declaration for this variable is in a function, but we are the module scope... how does that even work?`);
				}
				
				let curInFncScope = closedFromParent.get(functionScope);
				if(!curInFncScope) {
					curInFncScope = new Map();
					closedFromParent.set(functionScope, curInFncScope);
				}
				// I've given up on naming at this point
				let curInFncScope2 = curInFncScope.get(declFncScope);
				if(!curInFncScope2) {
					curInFncScope2 = [];
					curInFncScope.set(declFncScope, curInFncScope2);
				}
				curInFncScope2.push({ range, scopeName, decl: declObj });
	
				//let declScopeStart = declScope.declNode?.loc.start;
				//addDecoration(variableUsedOtherScope, varFixedRange, `Closed variable from parent scope "${scopeName}" ${declScopeStart?.line}:${declScopeStart?.column}`);
				return;
			}
		}

		// key is current function scope
		let closedFromParent: Map<ScopeObj,
			// key is declFncScope
			Map<ScopeObj, {
				range: vscode.Range;
				scopeName: string;
				decl: DeclObj;
			}[]>
		> = new Map();

		// Set of child scope close colorings
		let declarations: Map<DeclObj, Set<number>> = new Map();

		let time = Date.now();

		try {
			parseClosed(doc.getText(), onDeclare, onAccess);

			for(let [functionScope, declScopes] of closedFromParent) {
				let declScopesSorted = Array.from(declScopes.entries()).sort((b, a) => a[0].posStart - b[0].posStart);
				for(let i = 0; i < declScopesSorted.length; i++) {
					let [declScope, vars] = declScopesSorted[i];
					for(let { range, scopeName, decl } of vars) {
						let declScopeStart = declScope.posLineCol;
						addDecoration(getVariableUsedOtherScope(i), range, `Closed variable from parent scope "${scopeName}", ${i + 1}/${declScopesSorted.length} scopes closed. Scope declared at ${declScopeStart.line}:${declScopeStart.column}`);

						let declScopeColorings = declarations.get(decl);
						if(!declScopeColorings) {
							throw new Error(`Impossible, declaration not found`);
						}
						declScopeColorings.add(i);
					}
				}
			}

			for(let [obj, closedColorings] of declarations) {
				
				let countUsed = obj.uses.size;
	
				let range = new vscode.Range(doc.positionAt(obj.varPos), doc.positionAt(obj.varPos + obj.varName.length));
		
				if(closedColorings.size > 0) {
					let closedColoringsSorted = Array.from(closedColorings.values()).sort((b, a) => a - b);
					addDecoration(variableDeclarationHasCloses, range, `Declaration closed upon. Total uses (including non-closes), are: ${countUsed} times.`);
					for(let closeColoring of closedColoringsSorted) {
						addDecoration(getCloseColoring(closeColoring), range);
					}
				}
				else if(countUsed === 0) {
					addDecoration(variableDeclarationUnused, range, `Unused declaration`);
				} else {
					addDecoration(variableDeclaration, range, `Declaration used ${countUsed} times`);
				}
			}

		} catch(e) {
			vscode.window.showInformationMessage(`Parse error ${e.stack}!`);
		}

		time = Date.now() - time;

		console.log(`Parsed in ${time}ms`);

		let emptyDecorations = new Set(fullDecorationsList);

		for(let [decoration, options] of decorations) {
			emptyDecorations.delete(decoration);
			activeEditor.setDecorations(decoration, options);
		}

		for(let decoration of emptyDecorations) {
			activeEditor.setDecorations(decoration, []);
		}
	}

	let timeout: NodeJS.Timer | undefined = undefined;
	function triggerUpdateDecorations() {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		timeout = setTimeout(() => timeCode(updateDecorations), 500);
	}

	if (activeEditor) {
		triggerUpdateDecorations();
	}

	vscode.window.onDidChangeActiveTextEditor(editor => {
		activeEditor = editor;
		if (editor) {
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		if (activeEditor && event.document === activeEditor.document) {
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);



	let disposables: vscode.Disposable[] = [];

	disposables.push(vscode.languages.registerCodeLensProvider(
		{
			language: "typescript",
			scheme: "file",
			pattern: "*"
		},
		new TestCodeLensProvider()
	));


	context.subscriptions.push(...disposables);
}

// this method is called when your extension is deactivated
export function deactivate() {}

class TestCodeLensProvider implements vscode.CodeLensProvider {

	onDidChangeCodeLenses?: vscode.Event<void> | undefined;
	provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		return [
			new vscode.CodeLens(
				new vscode.Range(new vscode.Position(1, 0), new vscode.Position(2, 0))
			)
		];
	}

}