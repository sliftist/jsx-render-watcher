import { Node, Identifier, LineAndColumnData, SourceLocation, Program } from "@typescript-eslint/typescript-estree/dist/ts-estree/ts-estree";
import { parse, AST_NODE_TYPES } from "@typescript-eslint/typescript-estree";
import { EnterExitTraverser } from "./enterExitTraverser";

export interface ScopeObj {
    posStart: number;

    posLineCol: LineAndColumnData;
    scopeName: string;

    parentFncScope: ScopeObj|null;
    parentScope: ScopeObj|undefined;
    variables: Map<string, DeclObj>;
    type: "function"|"brace";
}
export interface DeclObj {
    varName: string;
    varPos: number;
    // Absolute text positions of the uses
    uses: Set<number>;
}


export function parseClosed(
    code: string,
    onDeclare: (obj: DeclObj, scope: ScopeObj) => void,
    onAccess: (
        declScope: ScopeObj|undefined,
        varName: string,
        varPos: number,
        curScope: ScopeObj,
        curFncScope: ScopeObj,
        declObj: DeclObj|undefined,
    ) => void
): Program {
    let lines = code.split(/\n/g);

    let lineStarts: number[] = [];
    {
        let pos = 0;
        for(let line of lines) {
            lineStarts.push(pos);
            pos += line.length + 1;
        }
    }

    function getText(range: SourceLocation) {
        let { start, end } = range;
        let text = "";
        for(let line = start.line; line <= end.line; line++) {
            let curLineText = lines[line - 1] + "\n";
            let colStart = 0;
            if(line === start.line) {
                colStart = start.column;
            }
            let colEnd = curLineText.length;
            if(line === end.line) {
                colEnd = end.column;
            }
            text += curLineText.slice(colStart, colEnd);
        }
        return text;
    }

    function getAbsolutePos(pos: LineAndColumnData) {
        return lineStarts[pos.line - 1] + pos.column;
    }

    let documentAST = parse(code, {
        module: true,
        ts: true,
        jsx: true,
        next: true,
        loc: true,
        ranges: true,
        raw: true,
    });
    
    

    function fixIdentifier(identifier: Identifier): { pos: number, idName: string } {
        // Try to adjust the range to be just the id, and not the type information. This should work with
        //	just an indexOf, because identifiers presumably can't be on multiple lines, or have
        //	stuff in the middle of them (so they should match just by a plain text search).
        let idText = getText(identifier.loc);
        let idName = identifier.name;
        let offset = idText.indexOf(idName);
        if(offset < 0) {
            throw new Error(`Identifier doesn't contain its name in its text. Should be impossible`);
        }
        return {
            pos: getAbsolutePos(identifier.loc.start) + offset,
            idName
        };
    }

    let phase: "populate"|"use" = "populate";

    
    class ScopeHolder {
        // (null represents the root scope)
        // { [scope]: { [variableName]: variableNode } }
        scopeEntries: Map<Node|null, ScopeObj> = new Map();
        scopeStack: (Node|null)[] = [null];

        constructor(parentFncScope: ScopeObj|null, private type: "function"|"brace") {
            this.scopeEntries.set(null, {
                posStart: 0,

                posLineCol: { line: 1, column: 0 },
                scopeName: "module",

                parentFncScope,
                parentScope: undefined,
                variables: new Map(),
                type,
            });
        }

        public getVariableScope(variableName: string) {
            for(let i = this.scopeStack.length - 1; i >= 0; i--) {
                let scope = this.scopeStack[i];
                let scopeObj = this.scopeEntries.get(scope);
                let varObj = scopeObj?.variables.get(variableName);
                if(scopeObj && varObj) {
                    return {scopeObj, varObj};
                }
            }
            return undefined;
        }
        public declareIdentifier(identifier: Node, nameOverride?: string) {
            let name = nameOverride || "";
            let varPos = -1;
            if(!name) {
                if(identifier.type === AST_NODE_TYPES.Identifier) {
                    let fixObj = fixIdentifier(identifier);
                    name = fixObj.idName;
                    varPos = fixObj.pos;
                } else {
                    debugger;
                    throw new Error(`Either identifier must be of type Identifier, or nameOverride must be passed.`);
                }
            }

            let scope = this.scopeEntries.get(this.scopeStack[this.scopeStack.length - 1]);
            if(!scope) throw new Error(`Internal error, no current scope`);
            if(scope.variables.has(name)) return;
            scope.variables.set(name, { varName: name, varPos, uses: new Set() });
        }

        public getCurrentScope(): ScopeObj {
            let scope = this.scopeEntries.get(this.scopeStack[this.scopeStack.length - 1]);
            if(!scope) {
                throw new Error(`Internal error, no scope. What happened to the root scope?`);
            }
            return scope;
        }


        public declareScope(node: Node, parentFncScope: ScopeObj) {
            let scope = this.scopeEntries.get(node);
            if(phase === "populate") {
                if(scope) {
                    throw new Error(`Internal error, scope declared twice`);
                }
                
                let scopeName = "";
                if("id" in node) {
                    let id = node.id;
                    if(id && id.type === AST_NODE_TYPES.Identifier) {
                        scopeName = id.name;
                    }
                }
                
                if(!scopeName) {
                    scopeName = parentFncScope.scopeName;
                }

                let pos = getAbsolutePos(node.loc.start);
                this.scopeEntries.set(node, {
                    posStart: pos,
                    posLineCol: node.loc.start,
                    scopeName,
                    parentFncScope,
                    parentScope: this.getCurrentScope(),
                    variables: new Map(),
                    type: this.type,
                });
            } else {
                if(!scope) {
                    throw new Error(`Internal error, cannot find scope, must have varied during rerun`);
                }
            }
            this.scopeStack.push(node);
        }

        public onNodeExit(node: Node) {
            let curScope = this.scopeStack[this.scopeStack.length - 1];
            if(curScope === node) {
                this.scopeStack.pop();
            }
        }

        public emitDeclarations() {
            for(let scope of this.scopeEntries.values()) {
                for(let varObj of scope.variables.values()) {
                    onDeclare(varObj, scope);
                }
            }
            //let declObj = getDeclaration(identifier, false);
            //onDeclare(declObj, identifier);
        }
    }

    let functionScope = new ScopeHolder(null, "function");
    let braceScope = new ScopeHolder(functionScope.getCurrentScope(), "brace");
    let usedRanges: Set<string> = new Set();

    
    function setScope(scope: Node, type: "function"|"brace") {
        if(type === "function") {
            functionScope.declareScope(scope, functionScope.getCurrentScope());
        } else {
            braceScope.declareScope(scope, functionScope.getCurrentScope());
        }
    }
    
    
    function getHideHash(node: Node) {
        return (
            node.loc.start.column+ "_" + node.loc.start.line
            + "_" + node.loc.end.column + "_" + node.loc.end.line + "_"
        );
    }

    function getDeclaration(identifier: Identifier, isAccess: boolean): {
        scopeObj: ScopeObj;
        varObj: DeclObj;
    }|undefined {
        let idObj = fixIdentifier(identifier);
        let fnc = functionScope.getVariableScope(idObj.idName);
        let brace = braceScope.getVariableScope(idObj.idName);

        let scope;
        let type: "function"|"brace";
        if(!brace) {
            scope = fnc;
            type = "function";
        } else if(!fnc) {
            scope = brace;
            type = "brace";
        } else {
            if(fnc.scopeObj.posStart >= brace.scopeObj.posStart) {
                scope = fnc;
                type = "function";
            } else {
                scope = brace;
                type = "brace";
            }
        }

        if(!scope) {
            return undefined;
        }

        if(isAccess) {
            let variablesObj = scope.scopeObj.variables.get(idObj.idName);
            if(!variablesObj) {
                throw new Error(`Internal error, variable isn't in scope matched`);
            }
            variablesObj.uses.add(idObj.pos);
        }

        return scope;
    }

    function declareIdentifier(identifier: Node, type: "function"|"brace", nameOverride?: string) {
        if(!nameOverride) {
            if(usedRanges.has(getHideHash(identifier))) return;
            usedRanges.add(getHideHash(identifier));
        }

        if(phase === "populate") {
            if(type === "function") {
                functionScope.declareIdentifier(identifier, nameOverride);
            } else {
                braceScope.declareIdentifier(identifier, nameOverride);
            }
        } else {
            
        }
    }
    
    function accessIdentifier(identifier: Identifier) {
        if(usedRanges.has(getHideHash(identifier))) return;
        usedRanges.add(getHideHash(identifier));

        if(identifier.name === "breakhere") {
            debugger;
        }

        if(phase === "populate") {

        } else {
        
            let fixObj = fixIdentifier(identifier);
            let declObj = getDeclaration(identifier, true);

            let fnc = functionScope.getCurrentScope();
            let brace = braceScope.getCurrentScope();

            let scope;
            if(fnc.posStart >= brace.posStart) {
                scope = fnc;
            } else {
                scope = brace;
            }

            onAccess(declObj?.scopeObj, fixObj.idName, fixObj.pos, scope, fnc, declObj?.varObj);
        }
    }


    let isInDeclaration = 0;
    let isInAssigment = 0;
    let curDeclarationType: "function"|"brace" = "function";

    runTraverse();
    usedRanges = new Set();
    phase = "use";
    isInDeclaration = 0;
    isInAssigment = 0;
    runTraverse();


    braceScope.emitDeclarations();
    functionScope.emitDeclarations();

    return documentAST;

    function runTraverse() {
        new EnterExitTraverser({
            enter(statement, parent, property) {
                if(property === "id" || property === "params") {
                    isInDeclaration++;
                    if(isInDeclaration > 1) {
                        debugger;
                    }
                }
                if(parent?.type === AST_NODE_TYPES.AssignmentExpression) {
                    isInAssigment++;
                }
                
                if(statement.type === AST_NODE_TYPES.VariableDeclarator) {
                    let identifierType = (
                        parent?.type === AST_NODE_TYPES.VariableDeclaration
                        && parent.kind === "var"
                        ? "function" as "function"
                        : "brace" as "brace"
                    );
                    if(isInDeclaration === 1) {
                        curDeclarationType = identifierType;
                    }
                    if(parent?.type === AST_NODE_TYPES.VariableDeclaration
                        && parent.declare
                    ) {
                        // Ignore type declarations
                        return false;
                    }
                    if(statement.id.type === AST_NODE_TYPES.Identifier) {
                        declareIdentifier(statement.id, identifierType);
                    }
                    if(statement.id.type === AST_NODE_TYPES.ArrayPattern) {
                        for(let elem of statement.id.elements) {
                            if(elem?.type === AST_NODE_TYPES.Identifier) {
                                declareIdentifier(elem, identifierType);
                            }
                        }
                    }
                }

                if(statement.type === AST_NODE_TYPES.TSEnumDeclaration) {
                    // Enums appear to be at the brace level. At the global level they are
                    //  defined with var... but inside nested braces they use let, so... brace looks like the intention.
                    declareIdentifier(statement.id, "brace");
                }

                if(statement.type === AST_NODE_TYPES.ExportSpecifier) {
                    // If we export a name different than the exported variable, ignore that identifer,
                    //  it isn't an access, and doesn't really exist in any scope.
                    if(statement.local.name !== statement.exported.name) {
                        usedRanges.add(getHideHash(statement.exported));
                    }
                }

                if(statement.type === AST_NODE_TYPES.ClassDeclaration) {
                    if(statement.id) {
                        declareIdentifier(statement.id, "function");
                    }

                    // Interestingly enough, this is scoped to the class. This means even in static constructors,
                    //  the this from any parent context is eclipsed. Of course... accessing this in static constructors
                    //  will give a typescript error (but not a javascript error), BUT, even with this error, the parent
                    //  this will still be eclipsed. Very interesting.
                    declareIdentifier(statement, "function", "this");
                }

                if(
                    statement.type === AST_NODE_TYPES.ImportSpecifier
                    || statement.type === AST_NODE_TYPES.ImportDefaultSpecifier
                    || statement.type === AST_NODE_TYPES.ImportNamespaceSpecifier
                ) {
                    declareIdentifier(statement.local, "function");
                }
                
                if(statement.type === AST_NODE_TYPES.MethodDefinition) {
                    if(statement.key.type === AST_NODE_TYPES.Identifier) {
                        usedRanges.add(getHideHash(statement.key));
                    }
                }

                if(statement.type === AST_NODE_TYPES.FunctionDeclaration
                || statement.type === AST_NODE_TYPES.FunctionExpression
                ) {
                    if("id" in statement && statement.id) {
                        declareIdentifier(statement.id, "function");
                    }

                    setScope(statement, "function");

                    // Declare implicit defines after the scope, so they exist within the scope.
                    // 	Every function implicitly defines these
                    declareIdentifier(statement, "function", "this");
                    declareIdentifier(statement, "function", "arguments");
                    declareIdentifier(statement, "function", "new.target");

                    // TODO: Implicit defines for super, in class constructors
                }
                if(statement.type === AST_NODE_TYPES.ArrowFunctionExpression) {
                    setScope(statement, "function");
                }
                
                if(statement.type === AST_NODE_TYPES.BlockStatement
                // Need to include the for statements, as their variable declarations are siblings to their
                //	block statement, but are inside the for scope.
                || statement.type === AST_NODE_TYPES.ForInStatement
                || statement.type === AST_NODE_TYPES.ForOfStatement
                || statement.type === AST_NODE_TYPES.ForStatement
                ) {
                    setScope(statement, "brace");
                }

                
                // If it has params, it is probably a function call
                if("params" in statement && statement.type !== AST_NODE_TYPES.TSMethodSignature) {
                    for(let param of statement.params) {
                        if(param.type === AST_NODE_TYPES.Identifier) {
                            declareIdentifier(param, "function");
                        }
                        if(param.type === AST_NODE_TYPES.AssignmentPattern) {
                            if(param.left.type === AST_NODE_TYPES.Identifier) {
                                declareIdentifier(param.left, "function");
                            }
                        } else if(param.type === AST_NODE_TYPES.RestElement) {
                            if(param.argument.type === AST_NODE_TYPES.Identifier) {
                                declareIdentifier(param.argument, "function");
                            }
                        }
                    }
                }


                if(statement.type === AST_NODE_TYPES.Property) {/// && isInAssigment === 0) {
                    if(isInDeclaration > 0) {
                        if(statement.key.type === AST_NODE_TYPES.Identifier) {
                            if(
                                statement.value.type === AST_NODE_TYPES.Identifier
                                && statement.key.loc.start.line === statement.value.loc.start.line
                                && statement.key.loc.start.column === statement.value.loc.start.column
                            ) {
                                declareIdentifier(statement.value, curDeclarationType);
                            } else {
                                
                                if(statement.value.type === AST_NODE_TYPES.Identifier) {
                                    declareIdentifier(statement.value, curDeclarationType);
                                    usedRanges.add(getHideHash(statement.key));
                                }
                            }
                            // It's... an access, but from the object on the other side, uh...
                            //	{ x: y } = obj, is the same as y = obj.x,
                            //	and so we shouldn't register an access for x, as it is really an access under an object.
                            usedRanges.add(getHideHash(statement.key));
                        }
                    } else {
                        if(
                            statement.key.type === AST_NODE_TYPES.Identifier
                            && statement.value.type === AST_NODE_TYPES.Identifier
                            && statement.key.loc.start.line === statement.value.loc.start.line
                            && statement.key.loc.start.column === statement.value.loc.start.column
                        ) {
                            accessIdentifier(statement.key);
                        }
                        if(statement.key.type === AST_NODE_TYPES.Identifier) {
                            usedRanges.add(getHideHash(statement.key));
                        }
                    }
                }

                if(isInDeclaration > 0) {
                    if(statement.type === AST_NODE_TYPES.RestElement) {
                        if(statement.argument.type === AST_NODE_TYPES.Identifier) {
                            declareIdentifier(statement.argument, curDeclarationType);
                        }
                    }
                }

                if(statement.type === AST_NODE_TYPES.ArrayPattern) {
                    if(isInDeclaration > 0) {
                        for(let elem of statement.elements) {
                            if(elem && elem.type === AST_NODE_TYPES.Identifier) {
                                declareIdentifier(elem, "function");
                            }
                        }
                    }
                }

                if(statement.type === AST_NODE_TYPES.ClassProperty) {
                    if(statement.key.type === AST_NODE_TYPES.Identifier) {
                        usedRanges.add(getHideHash(statement.key));
                    }
                }


                if(parent?.type === AST_NODE_TYPES.CatchClause && property === "param") {
                    return false;
                }

                if(statement.type === AST_NODE_TYPES.TSEnumDeclaration) {
                    return false;
                }

                // Ignore all "TS" stuff. It isn't realy, and will go away after compilation.
                if(statement.type.startsWith("TS")) {
                    return false;
                }

                if((parent?.type === AST_NODE_TYPES.MemberExpression || parent?.type === AST_NODE_TYPES.OptionalMemberExpression)
                && property === "property" && !parent.computed) {
                    // x.Y, so, ignore Y
                    return false;
                }

                /*
                let isObjectDestructure = false;
                if(
                    statement.type === AST_NODE_TYPES.Identifier
                    && property === "key"
                    parent
                    && "value" in parent && parent.value && typeof parent.value === "object"
                    && "type" in parent.value && parent.value.type === AST_NODE_TYPES.Identifier
                    && parent.value.name) {
                }
                //!parent || !("value" in parent) || !parent.value || parent.value.type !== AST_NODE_TYPES.Ide
                */

                if(
                    statement.type === AST_NODE_TYPES.Identifier
                    && (isInAssigment === 0 || property !== "key")
                ) {
                    accessIdentifier(statement);
                }

                
                if(statement.type === AST_NODE_TYPES.ThisExpression) {
                    // Not great, but we want to both preserve the object (so we can use it in maps),
                    //	and not have to have every place that handles an identifier also have to handle Identifer and ThisExpression
                    (statement as any).name = "this";
                    accessIdentifier(statement as any);
                }

                if(statement.type === AST_NODE_TYPES.MetaProperty) {
                    if(statement.meta.name === "new" && statement.property.name === "target") {
                        (statement as any).name = "new.target";
                        accessIdentifier(statement as any);
                        return false;
                    }
                }
            },
            exit(statement, parent, property) {
                if(property === "id" || property === "params") {
                    isInDeclaration--;
                }
                if(parent?.type === AST_NODE_TYPES.AssignmentExpression) {
                    isInAssigment--;
                }
                /*
                if(parent?.type === AST_NODE_TYPES.VariableDeclarator && property === "init") {
                    isInAssigment--;
                }
                */

                functionScope.onNodeExit(statement);
                braceScope.onNodeExit(statement);
            }
        }).traverse(documentAST);
    }
}