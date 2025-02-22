import { eScriptNode, ScriptNode } from "./scriptnode";
import { Tokenizer } from "./tokenizer";
import { eTokenType, EXPLICIT_TOKEN, EXTERNAL_TOKEN, FINAL_TOKEN, FUNCTION_TOKEN, IF_HANDLE_TOKEN, OVERRIDE_TOKEN, PrintToken, PROPERTY_TOKEN, SHARED_TOKEN, Token } from "./tokens";

var objIdMap=new WeakMap, objectCount = 0;
function objectId(object: ScriptNode){
  if (!objIdMap.has(object)) objIdMap.set(object,++objectCount);
  return objIdMap.get(object) + "";
}
interface node {
    id: string
    label: string
}

interface edges {
    from: string,
    to: string,
}

function PrintTree(tree: ScriptNode)
{
    let queue = [];

    queue.push(tree);

    let nodes: node[] = [];
    let edges: edges[] = [];

    while(queue.length > 0)
    {
        let elem = queue.shift();

        if (!elem)
        {
            break;
        }
        
        nodes.push({id: objectId(elem), label: eScriptNode[elem.nodeType]});

        for(let child: ScriptNode | null | undefined = elem.firstChild; child; child = child.next)
        {
            edges.push({from: objectId(elem), to: objectId(child)})
            if (child as ScriptNode)
            {
                queue.push(child);
            }
        }
    }

    return {
        "kind": { "graph": true },
        "nodes": nodes,
        "edges": edges,
    }
}

const _global = globalThis as any;
_global.PrintTree = PrintTree;

export class Parser
{
    tokenizer: Tokenizer;
    isSyntaxError = false;
    root: ScriptNode;

    constructor(source: string)
    {
        this.tokenizer = new Tokenizer(source);
        this.root = this.CreateNode(eScriptNode.snScript);
    }

    GetRootNode() : ScriptNode
    {
        return this.root;
    }

    ParseScript() : ScriptNode
    {
        let node = this.root;

        while (true)
        {
            while (!this.isSyntaxError)
            {
                let token = this.GetToken();

                if (token.type == eTokenType.ttEnd)
                {
                    return node;
                }

                this.RewindTo(token);

                if (token.type == eTokenType.ttImport)
                {
                }

                if (token.type == eTokenType.ttConst || token.type == eTokenType.ttScope || token.type == eTokenType.ttAuto || this.IsDataType(token))
                {
                    node.AddChildLast(this.ParseFunction());
                }

                // if( t1.type == ttImport )
                //     node->AddChildLast(ParseImport());
                // else if( t1.type == ttEnum )
                //     node->AddChildLast(ParseEnumeration());	// Handle enumerations
                // else if( t1.type == ttTypedef )
                //     node->AddChildLast(ParseTypedef());		// Handle primitive typedefs
                // else if( t1.type == ttClass )
                //     node->AddChildLast(ParseClass());
                // else if( t1.type == ttMixin )
                //     node->AddChildLast(ParseMixin());
                // else if( t1.type == ttInterface )
                //     node->AddChildLast(ParseInterface());
                // else if( t1.type == ttFuncDef )
                //     node->AddChildLast(ParseFuncDef());
                // else if( t1.type == ttConst || t1.type == ttScope || t1.type == ttAuto || IsDataType(t1) )
                // {
                //     if( IsVirtualPropertyDecl() )
                //         node->AddChildLast(ParseVirtualPropertyDecl(false, false));
                //     else if( IsVarDecl() )
                //         node->AddChildLast(ParseDeclaration(false, true));
                //     else
                //         node->AddChildLast(ParseFunction());
                // }
                // else if( t1.type == ttEndStatement )
                // {
                //     // Ignore a semicolon by itself
                //     GetToken(&t1);
                // }
                // else if( t1.type == ttNamespace )
                //     node->AddChildLast(ParseNamespace());
                // else if( t1.type == ttEnd )
                //     return node;
                // else if( inBlock && t1.type == ttEndStatementBlock )
                //     return node;
                // else
                // {
                //     asCString str;
                //     const char *t = asCTokenizer::GetDefinition(t1.type);
                //     if( t == 0 ) t = "<unknown token>";

                //     str.Format(TXT_UNEXPECTED_TOKEN_s, t);

                //     Error(str, &t1);
                // }
            }
        }
    }

    CreateNode(type: eScriptNode): ScriptNode 
    {
        return new ScriptNode(type);
    }

    GetToken = () => this.tokenizer.ConsumeToken();
    RewindTo = (token: Token) => this.tokenizer.RewindToToken(token);
    IdentifierIs = (token: Token, identifier: string) => this.tokenizer.IdentifierIs(token, identifier);

    ParseFunction(isMethod: boolean = false): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snFunction);

        let token = this.GetToken();

        if (!isMethod)
        {
            // A global function can be marked as shared and external
            while (token.type == eTokenType.ttIdentifier)
            {
                if (this.IdentifierIs(token, SHARED_TOKEN) || this.IdentifierIs(token, EXTERNAL_TOKEN))
                {
                    this.RewindTo(token);
                    node.AddChildLast(this.ParseIdentifier());
                    if (this.isSyntaxError) 
                    {
                        return node;
                    }
                }
                else
                {
                    break;
                }

                token = this.GetToken();
            }
        }

        // A class method can start with 'private' or 'protected'
        if (isMethod && token.type == eTokenType.ttPrivate)
        {
            this.RewindTo(token);
            node.AddChildLast(this.ParseToken(eTokenType.ttPrivate));
            token = this.GetToken();
        }
        else if (isMethod && token.type == eTokenType.ttProtected)
        {
            this.RewindTo(token);
            node.AddChildLast(this.ParseToken(eTokenType.ttProtected));
            token = this.GetToken();
        }

        if (this.isSyntaxError) return node;

        // If it is a global function, or a method, except constructor and destructor, then the return type is parsed
        let token2 = this.GetToken();
        this.RewindTo(token);

        if (!isMethod || (token.type != eTokenType.ttBitNot && token.type != eTokenType.ttOpenParanthesis))
        {
            node.AddChildLast(this.ParseType(true));
            if (this.isSyntaxError) return node;

            var typemod = this.ParseTypeMod(false);
            if (typemod)
            {
                node.AddChildLast(typemod);
            }

            if (this.isSyntaxError) return node;
        }

        // If this is a class destructor then it starts with ~, and no return type is declared
        if (isMethod && token.type == eTokenType.ttBitNot)
        {
            node.AddChildLast(this.ParseToken(eTokenType.ttBitNot));
            if (this.isSyntaxError) return node;
        }

        node.AddChildLast(this.ParseIdentifier());
        if (this.isSyntaxError) return node;

        node.AddChildLast(this.ParseParameterList());
        if (this.isSyntaxError) return node;

        if (isMethod)
        {
            token = this.GetToken();
            this.RewindTo(token);

            // Is the method a const?
            if (token.type == eTokenType.ttConst)
                node.AddChildLast(this.ParseToken(eTokenType.ttConst));
        }

        // TODO: Should support abstract methods, in which case no statement block should be provided
        this.ParseMethodAttributes(node);
        if (this.isSyntaxError) return node;

        // External shared functions must be ended with ';'
        token = this.GetToken();
        this.RewindTo(token);
        if (token.type == eTokenType.ttEndStatement)
        {
            node.AddChildLast(this.ParseToken(eTokenType.ttEndStatement));
            return node;
        }

        // We should just find the end of the statement block here. The statements
        // will be parsed on request by the compiler once it starts the compilation.
        node.AddChildLast(this.ParseStatementBlock());

        return node;
    }

    ParseMethodAttributes(funcNode: ScriptNode)
    {
        let t1;

        for (; ;)
        {
            t1 = this.GetToken();
            this.RewindTo(t1);

            if (this.IdentifierIs(t1, FINAL_TOKEN) ||
                this.IdentifierIs(t1, OVERRIDE_TOKEN) ||
                this.IdentifierIs(t1, EXPLICIT_TOKEN) ||
                this.IdentifierIs(t1, PROPERTY_TOKEN))
                funcNode.AddChildLast(this.ParseIdentifier());
            else
                break;
        }
    }

    ParseStatementBlock(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snStatementBlock);

        let t1 = this.GetToken();

        if (t1.type != eTokenType.ttStartStatementBlock)
        {
            this.Error();
            return node;
        }

        let start = t1;

        node.UpdateSourcePosition(t1.pos, t1.length);

        for (;;)
        {
            while (!this.isSyntaxError)
            {
                t1 = this.GetToken();
                if (t1.type == eTokenType.ttEndStatementBlock)
                {
                    node.UpdateSourcePosition(t1.pos, t1.length);

                    // Statement block is finished
                    return node;
                }
                else
                {
                    this.RewindTo(t1);

                    if (this.IsVarDecl())
                        node.AddChildLast(this.ParseDeclaration());
                    else
                        node.AddChildLast(this.ParseStatement());
                }
            }

            if (this.isSyntaxError)
            {
                // Search for either ';', '{', '}', or end
                t1 = this.GetToken();
                while (t1.type != eTokenType.ttEndStatement && t1.type != eTokenType.ttEnd &&
                    t1.type != eTokenType.ttStartStatementBlock && t1.type != eTokenType.ttEndStatementBlock)
                {
                    t1 = this.GetToken();
                }

                // Skip this statement block
                if (t1.type == eTokenType.ttStartStatementBlock)
                {
                    // Find the end of the block and skip nested blocks
                    let level = 1;
                    while (level > 0)
                    {
                        t1 = this.GetToken();
                        if (t1.type == eTokenType.ttStartStatementBlock) level++;
                        if (t1.type == eTokenType.ttEndStatementBlock) level--;
                        if (t1.type == eTokenType.ttEnd) break;
                    }
                }
                else if (t1.type == eTokenType.ttEndStatementBlock)
                {
                    this.RewindTo(t1);
                }
                else if (t1.type == eTokenType.ttEnd)
                {
                    this.Error();
                    return node;
                }

                this.isSyntaxError = false;
            }
        }
    }

    ParseStatement(): ScriptNode
    {
        let t1 = this.GetToken();
        this.RewindTo(t1);

        if (t1.type == eTokenType.ttIf)
            return this.ParseIf();
        else if (t1.type == eTokenType.ttFor)
            return this.ParseFor();
        else if (t1.type == eTokenType.ttWhile)
            return this.ParseWhile();
        else if (t1.type == eTokenType.ttReturn)
            return this.ParseReturn();
        else if (t1.type == eTokenType.ttStartStatementBlock)
            return this.ParseStatementBlock();
        else if (t1.type == eTokenType.ttBreak)
            return this.ParseBreak();
        else if (t1.type == eTokenType.ttContinue)
            return this.ParseContinue();
        else if (t1.type == eTokenType.ttDo)
            return this.ParseDoWhile();
        else if (t1.type == eTokenType.ttSwitch)
            return this.ParseSwitch();
        else if (t1.type == eTokenType.ttTry)
            return this.ParseTryCatch();
        else
        {
            if (this.IsVarDecl())
            {
                this.Error();
            }
            return this.ParseExpressionStatement();
        }
    }

    ParseIf(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snIf);

        let t = this.GetToken();

        if (t.type != eTokenType.ttIf)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        t = this.GetToken();
        if (t.type != eTokenType.ttOpenParanthesis)
        {
            this.Error();
            return node;
        }

        node.AddChildLast(this.ParseAssignment());
        if (this.isSyntaxError) return node;

        t = this.GetToken();

        console.log(PrintToken(t, this.tokenizer.source.source));
        if (t.type != eTokenType.ttCloseParanthesis)
        {
            this.Error();
            return node;
        }

        node.AddChildLast(this.ParseStatement());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type != eTokenType.ttElse)
        {
            // No else statement return already
            this.RewindTo(t);
            return node;
        }

        node.AddChildLast(this.ParseStatement());

        return node;
    }

    ParseFor(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snFor);

        let t = this.GetToken();
        if (t.type != eTokenType.ttFor)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        t = this.GetToken();
        if (t.type != eTokenType.ttOpenParanthesis)
        {
            this.Error();
            return node;
        }

        if (this.IsVarDecl())
            node.AddChildLast(this.ParseDeclaration());
        else
            node.AddChildLast(this.ParseExpressionStatement());
        if (this.isSyntaxError) return node;

        node.AddChildLast(this.ParseExpressionStatement());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type != eTokenType.ttCloseParanthesis)
        {
            this.RewindTo(t);

            // Parse N increment statements separated by ,
            for (; ;)
            {
                let n = this.CreateNode(eScriptNode.snExpressionStatement);
                node.AddChildLast(n);
                n.AddChildLast(this.ParseAssignment());
                if (this.isSyntaxError) return node;

                t = this.GetToken();
                if (t.type == eTokenType.ttListSeparator)
                    continue;
                else if (t.type == eTokenType.ttCloseParanthesis)
                    break;
                else
                {
                    this.Error();
                    return node;
                }
            }
        }

        node.AddChildLast(this.ParseStatement());

        return node;
    }

    ParseWhile(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snWhile);
        let t = this.GetToken();

        if (t.type != eTokenType.ttWhile)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        t = this.GetToken();
        if (t.type != eTokenType.ttOpenParanthesis)
        {
            this.Error();
            return node;
        }

        node.AddChildLast(this.ParseAssignment());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type != eTokenType.ttCloseParanthesis)
        {
            this.Error();
            return node;
        }

        node.AddChildLast(this.ParseStatement());

        return node;
    }

    ParseReturn(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snReturn);

        let t = this.GetToken();
        if (t.type != eTokenType.ttReturn)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        t = this.GetToken();
        if (t.type == eTokenType.ttEndStatement)
        {
            node.UpdateSourcePosition(t.pos, t.length);
            return node;
        }

        this.RewindTo(t);

        node.AddChildLast(this.ParseAssignment());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type != eTokenType.ttEndStatement)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        return node;
    }

    ParseBreak(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snBreak);
        let t = this.GetToken();
        if (t.type != eTokenType.ttBreak)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        t = this.GetToken();
        if (t.type != eTokenType.ttEndStatement)
        {
            this.Error();
        }

        node.UpdateSourcePosition(t.pos, t.length);

        return node;
    }

    ParseContinue(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snContinue);

        let t = this.GetToken();
        if (t.type != eTokenType.ttContinue)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        t = this.GetToken();
        if (t.type != eTokenType.ttEndStatement)
        {
            this.Error();
        }

        node.UpdateSourcePosition(t.pos, t.length);

        return node;
    }

    ParseDoWhile(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snDoWhile);

        let t = this.GetToken();
        if (t.type != eTokenType.ttDo)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        node.AddChildLast(this.ParseStatement());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type != eTokenType.ttWhile)
        {
            this.Error();
            return node;
        }

        t = this.GetToken();
        if (t.type != eTokenType.ttOpenParanthesis)
        {
            this.Error();
            return node;
        }

        node.AddChildLast(this.ParseAssignment());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type != eTokenType.ttCloseParanthesis)
        {
            this.Error();
            return node;
        }

        t = this.GetToken();
        if (t.type != eTokenType.ttEndStatement)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        return node;
    }

    ParseSwitch(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snSwitch);

        let t = this.GetToken();
        if (t.type != eTokenType.ttSwitch)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        t = this.GetToken();
        if (t.type != eTokenType.ttOpenParanthesis)
        {
            this.Error();
            return node;
        }

        node.AddChildLast(this.ParseAssignment());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type != eTokenType.ttCloseParanthesis)
        {
            this.Error();
            return node;
        }

        t = this.GetToken();
        if (t.type != eTokenType.ttStartStatementBlock)
        {
            this.Error();
            return node;
        }

        while (!this.isSyntaxError)
        {
            t = this.GetToken();

            if (t.type == eTokenType.ttEndStatementBlock)
                break;

            this.RewindTo(t);

            if (t.type != eTokenType.ttCase && t.type != eTokenType.ttDefault)
            {
                this.Error();
                return node;
            }

            node.AddChildLast(this.ParseCase());
            if (this.isSyntaxError) return node;
        }

        if (t.type != eTokenType.ttEndStatementBlock)
        {
            this.Error();
            return node;
        }

        return node;
    }

    ParseCase(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snCase);

        let t = this.GetToken();

        if (t.type != eTokenType.ttCase && t.type != eTokenType.ttDefault)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        if (t.type == eTokenType.ttCase)
        {
            node.AddChildLast(this.ParseExpression());
        }

        t = this.GetToken();
        if (t.type != eTokenType.ttColon)
        {
            this.Error();
            return node;
        }

        // Parse statements until we find either of }, case, default, and break
        t = this.GetToken();
        this.RewindTo(t);
        while (t.type != eTokenType.ttCase &&
            t.type != eTokenType.ttDefault &&
            t.type != eTokenType.ttEndStatementBlock &&
            t.type != eTokenType.ttBreak)
        {
            if (this.IsVarDecl())
                // Variable declarations are not allowed, but we parse it anyway to give a good error message
                node.AddChildLast(this.ParseDeclaration());
            else
                node.AddChildLast(this.ParseStatement());
            if (this.isSyntaxError) return node;

            t = this.GetToken();
            this.RewindTo(t);
        }

        // If the case was ended with a break statement, add it to the node
        if (t.type == eTokenType.ttBreak)
            node.AddChildLast(this.ParseBreak());

        return node;
    }

    ParseTryCatch(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snTryCatch);

        let t = this.GetToken();
        if (t.type != eTokenType.ttTry)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        node.AddChildLast(this.ParseStatementBlock());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type != eTokenType.ttCatch)
        {
            this.Error();
            return node;
        }

        node.AddChildLast(this.ParseStatementBlock());
        if (this.isSyntaxError) return node;

        return node;
    }

    ParseDeclaration(isClassProp: boolean = false, isGlobalVar: boolean = false): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snDeclaration);

        let t = this.GetToken();
        this.RewindTo(t);

        // A class property can be preceeded by private
        if (t.type == eTokenType.ttPrivate && isClassProp)
            node.AddChildLast(this.ParseToken(eTokenType.ttPrivate));
        else if (t.type == eTokenType.ttProtected && isClassProp)
            node.AddChildLast(this.ParseToken(eTokenType.ttProtected));

        // Parse data type
        node.AddChildLast(this.ParseType(true, false, !isClassProp));
        if (this.isSyntaxError) return node;

        for (; ;)
        {
            // Parse identifier
            node.AddChildLast(this.ParseIdentifier());
            if (this.isSyntaxError) return node;

            if (isClassProp || isGlobalVar)
            {
                // Only superficially parse the initialization info for the class property
                t = this.GetToken();
                this.RewindTo(t);
                if (t.type == eTokenType.ttAssignment || t.type == eTokenType.ttOpenParanthesis)
                {
                    // node.AddChildLast(this.SuperficiallyParseVarInit());
                    if (this.isSyntaxError) return node;
                }
            }
            else
            {
                // If next token is assignment, parse expression
                t = this.GetToken();
                if (t.type == eTokenType.ttOpenParanthesis)
                {
                    this.RewindTo(t);
                    node.AddChildLast(this.ParseArgList());
                    if (this.isSyntaxError) return node;
                }
                else if (t.type == eTokenType.ttAssignment)
                {
                    t = this.GetToken();
                    this.RewindTo(t);
                    if (t.type == eTokenType.ttStartStatementBlock)
                    {
                        node.AddChildLast(this.ParseInitList());
                        if (this.isSyntaxError) return node;
                    }
                    else
                    {
                        node.AddChildLast(this.ParseAssignment());
                        if (this.isSyntaxError) return node;
                    }
                }
                else
                    this.RewindTo(t);
            }

            // continue if list separator, else terminate with end statement
            t = this.GetToken();
            if (t.type == eTokenType.ttListSeparator)
                continue;
            else if (t.type == eTokenType.ttEndStatement)
            {
                node.UpdateSourcePosition(t.pos, t.length);
                return node;
            }
            else
            {
                this.Error();
                return node;
            }
        }
    }

    ParseParameterList(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snParameterList);

        let t1 = this.GetToken();
        if (t1.type != eTokenType.ttOpenParanthesis)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t1.pos, t1.length);

        t1 = this.GetToken();
        if (t1.type == eTokenType.ttCloseParanthesis)
        {
            node.UpdateSourcePosition(t1.pos, t1.length);

            // Statement block is finished
            return node;
        }
        else
        {
            // If the parameter list is just (void) then the void token should be ignored
            if (t1.type == eTokenType.ttVoid)
            {
                let t2 = this.GetToken();
                if (t2.type == eTokenType.ttCloseParanthesis)
                {
                    node.UpdateSourcePosition(t2.pos, t2.length);
                    return node;
                }
            }

            this.RewindTo(t1);

            for (; ;)
            {
                // Parse data type
                node.AddChildLast(this.ParseType(true));
                if (this.isSyntaxError) return node;

                let typemod = this.ParseTypeMod(true)
                if (typemod)
                {
                    node.AddChildLast(typemod);
                }

                if (this.isSyntaxError) return node;

                // Parse optional identifier
                t1 = this.GetToken();
                if (t1.type == eTokenType.ttIdentifier)
                {
                    this.RewindTo(t1);
                    node.AddChildLast(this.ParseIdentifier());
                    if (this.isSyntaxError) return node;

                    t1 = this.GetToken();
                }

                // Parse optional expression for the default arg
                if (t1.type == eTokenType.ttAssignment)
                {
                    // Do a superficial parsing of the default argument
                    // The actual parsing will be done when the argument is compiled for a function call
                    node.AddChildLast(this.ParseExpression());
                    if (this.isSyntaxError) return node;

                    t1 = this.GetToken();
                }

                // Check if list continues
                if (t1.type == eTokenType.ttCloseParanthesis)
                {
                    node.UpdateSourcePosition(t1.pos, t1.length);
                    return node;
                }
                else if (t1.type == eTokenType.ttListSeparator)
                {
                    continue;
                }
                else
                {
                    this.Error();
                    return node;
                }
            }
        }
    }

    ParseInitList(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snInitList);

        let t1 = this.GetToken();
        if (t1.type != eTokenType.ttStartStatementBlock)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t1.pos, t1.length);

        t1 = this.GetToken();
        if (t1.type == eTokenType.ttEndStatementBlock)
        {
            node.UpdateSourcePosition(t1.pos, t1.length);

            // Statement block is finished
            return node;
        }
        else
        {
            this.RewindTo(t1);
            for (; ;)
            {
                t1 = this.GetToken();
                if (t1.type == eTokenType.ttListSeparator)
                {
                    // No expression
                    node.AddChildLast(this.CreateNode(eScriptNode.snUndefined));
                    node.lastChild?.UpdateSourcePosition(t1.pos, 1);

                    t1 = this.GetToken();
                    if (t1.type == eTokenType.ttEndStatementBlock)
                    {
                        // No expression
                        node.AddChildLast(this.CreateNode(eScriptNode.snUndefined));
                        node.lastChild?.UpdateSourcePosition(t1.pos, 1);
                        node.UpdateSourcePosition(t1.pos, t1.length);
                        return node;
                    }

                    this.RewindTo(t1);
                }
                else if (t1.type == eTokenType.ttEndStatementBlock)
                {
                    // No expression
                    node.AddChildLast(this.CreateNode(eScriptNode.snUndefined));
                    node.lastChild?.UpdateSourcePosition(t1.pos, 1);
                    node.UpdateSourcePosition(t1.pos, t1.length);

                    // Statement block is finished
                    return node;
                }
                else if (t1.type == eTokenType.ttStartStatementBlock)
                {
                    this.RewindTo(t1);
                    node.AddChildLast(this.ParseInitList());
                    if (this.isSyntaxError) return node;

                    t1 = this.GetToken();
                    if (t1.type == eTokenType.ttListSeparator)
                        continue;
                    else if (t1.type == eTokenType.ttEndStatementBlock)
                    {
                        node.UpdateSourcePosition(t1.pos, t1.length);

                        // Statement block is finished
                        return node;
                    }
                    else
                    {
                        this.Error();
                        return node;
                    }
                }
                else
                {
                    this.RewindTo(t1);
                    node.AddChildLast(this.ParseAssignment());
                    if (this.isSyntaxError) return node;

                    t1 = this.GetToken();
                    if (t1.type == eTokenType.ttListSeparator)
                        continue;
                    else if (t1.type == eTokenType.ttEndStatementBlock)
                    {
                        node.UpdateSourcePosition(t1.pos, t1.length);

                        // Statement block is finished
                        return node;
                    }
                    else
                    {
                        this.Error();
                        return node;
                    }
                }
            }
        }
    }

    ParseAssignment(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snAssignment);

        node.AddChildLast(this.ParseCondition());
        if (this.isSyntaxError) return node;

        let t = this.GetToken();
        this.RewindTo(t);

        PrintToken(t, this.tokenizer.source.source);

        if (this.IsAssignOperator(t.type))
        {
            node.AddChildLast(this.ParseAssignOperator());
            if (this.isSyntaxError) return node;

            node.AddChildLast(this.ParseAssignment());
            if (this.isSyntaxError) return node;
        }

        return node;
    }

    ParseCondition(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snCondition);

        node.AddChildLast(this.ParseExpression());
        if (this.isSyntaxError) return node;

        let t = this.GetToken();
        if (t.type == eTokenType.ttQuestion)
        {
            node.AddChildLast(this.ParseAssignment());
            if (this.isSyntaxError) return node;

            t = this.GetToken();
            if (t.type != eTokenType.ttColon)
            {
                this.Error();
                return node;
            }

            node.AddChildLast(this.ParseAssignment());
            if (this.isSyntaxError) return node;
        }
        else
            this.RewindTo(t);

        return node;
    }

    ParseExpressionStatement(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snExpressionStatement);

        let t = this.GetToken();
        if (t.type == eTokenType.ttEndStatement)
        {
            node.UpdateSourcePosition(t.pos, t.length);

            return node;
        }

        this.RewindTo(t);

        node.AddChildLast(this.ParseAssignment());
        if (this.isSyntaxError) return node;

        t = this.GetToken();
        if (t.type != eTokenType.ttEndStatement)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t.pos, t.length);

        return node;
    }

    ParseExpression(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snExpression);

        node.AddChildLast(this.ParseExprTerm());
        if (this.isSyntaxError) 
        {
            return node;
        }

        for (; ;)
        {
            let t = this.GetToken();
            this.RewindTo(t);

            if (!this.IsOperator(t.type))
                return node;

            node.AddChildLast(this.ParseExprOperator());
            if (this.isSyntaxError) 
            {
                return node;
            }

            node.AddChildLast(this.ParseExprTerm());
            if (this.isSyntaxError) 
            {
                return node;
            }
        }
    }

    ParseExprTerm(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snExprTerm);

        // Check if the expression term is an initialization of a temp object with init list, i.e. type = {...}
        let t = this.GetToken();
        let t2 = t;
        let t3;
        if (this.IsDataType(t2) && this.CheckTemplateType(t2))
        {
            // The next token must be a = followed by a {
            t2 = this.GetToken();
            t3 = this.GetToken();
            if (t2.type == eTokenType.ttAssignment && t3.type == eTokenType.ttStartStatementBlock)
            {
                // It is an initialization, now parse it for real
                this.RewindTo(t);
                node.AddChildLast(this.ParseType(false));
                t2 = this.GetToken();
                node.AddChildLast(this.ParseInitList());
                return node;
            }
        }
        // Or an anonymous init list, i.e. {...}
        else if (t.type == eTokenType.ttStartStatementBlock)
        {
            this.RewindTo(t);
            node.AddChildLast(this.ParseInitList());
            return node;
        }

        // It wasn't an initialization, so it must be an ordinary expression term
        this.RewindTo(t);

        for (;;)
        {
            t = this.GetToken();
            this.RewindTo(t);

            if (!this.IsPreOperator(t.type))
                break;

            node.AddChildLast(this.ParseExprPreOp());
            if (this.isSyntaxError)
            {
                return node;
            }
        }

        node.AddChildLast(this.ParseExprValue());

        if (this.isSyntaxError)
        {
            return node;
        }

        for (;;)
        {
            t = this.GetToken();
            this.RewindTo(t);
            if (!this.IsPostOperator(t.type))
                return node;

            node.AddChildLast(this.ParseExprPostOp());
            if (this.isSyntaxError)
            {
                return node;
            }
        }
    }

    ParseExprPreOp(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snExprPreOp);

        let t = this.GetToken();
        if (!this.IsPreOperator(t.type))
        {
            this.Error();
            return node;
        }

        node.SetToken(t);

        return node;
    }

    ParseExprPostOp(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snExprPostOp);

        let t = this.GetToken();
        if (!this.IsPostOperator(t.type))
        {
            this.Error();
            return node;
        }

        node.SetToken(t);

        if (t.type == eTokenType.ttDot)
        {
            let t1 = this.GetToken();
            let t2 = this.GetToken();
            this.RewindTo(t1);

            if (t2.type == eTokenType.ttOpenParanthesis)
                node.AddChildLast(this.ParseFunctionCall());
            else
                node.AddChildLast(this.ParseIdentifier());
        }
        else if (t.type == eTokenType.ttOpenBracket)
        {
            node.AddChildLast(this.ParseArgList(false));

            t = this.GetToken();
            if (t.type != eTokenType.ttCloseBracket)
            {
                this.Error();
                return node;
            }

            node.UpdateSourcePosition(t.pos, t.length);
        }
        else if (t.type == eTokenType.ttOpenParanthesis)
        {
            this.RewindTo(t);
            node.AddChildLast(this.ParseArgList());
        }

        return node;
    }

    ParseExprValue(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snExprValue);

        let t1 = this.GetToken();
        let t2 = this.GetToken();
        this.RewindTo(t1);

        // 'void' is a special expression that doesn't do anything (normally used for skipping output arguments)
        if (t1.type == eTokenType.ttVoid)
            node.AddChildLast(this.ParseToken(eTokenType.ttVoid));
        else if (this.IsRealType(t1.type))
            node.AddChildLast(this.ParseConstructCall());
        else if (t1.type == eTokenType.ttIdentifier || t1.type == eTokenType.ttScope)
        {
            // Check if the expression is an anonymous function
            if (this.IsLambda())
            {
                node.AddChildLast(this.ParseLambda());
            }
            else
            {
                // Determine the last identifier in order to check if it is a type
                let t;
                if (t1.type == eTokenType.ttScope) t = t2; else t = t1;
                this.RewindTo(t);
                t2 = this.GetToken();
                while (t.type == eTokenType.ttIdentifier)
                {
                    t2 = t;
                    t = this.GetToken();
                    if (t.type == eTokenType.ttScope)
                        t = this.GetToken();
                    else
                        break;
                }

                let isDataType = this.IsDataType(t2);
                let isTemplateType = false;
                if (isDataType)
                {
                    // Is this a template type?
                    // tempString.Assign(& script -> code[t2.pos], t2.length);
                    // if (engine -> IsTemplateType(tempString.AddressOf()))
                    //     isTemplateType = true;
                }

                t2 = this.GetToken();

                // Rewind so the real parsing can be done, after deciding what to parse
                this.RewindTo(t1);

                // Check if this is a construct call
                // Just 'type()' isn't considered a construct call, because type may just be a function/method name.
                // The compiler will have to sort this out, since the parser doesn't have enough information.
                if (isDataType && (t.type == eTokenType.ttOpenBracket && t2.type == eTokenType.ttCloseBracket))      // type[]()
                    node.AddChildLast(this.ParseConstructCall());
                else if (isTemplateType && t.type == eTokenType.ttLessThan)  // type<t>()
                    node.AddChildLast(this.ParseConstructCall());
                else if (this.IsFunctionCall())
                    node.AddChildLast(this.ParseFunctionCall());
                else
                    node.AddChildLast(this.ParseVariableAccess());
            }
        }
        else if (t1.type == eTokenType.ttCast)
            node.AddChildLast(this.ParseCast());
        else if (this.IsConstant(t1.type))
            node.AddChildLast(this.ParseConstant());
        else if (t1.type == eTokenType.ttOpenParanthesis)
        {
            t1 = this.GetToken();
            node.UpdateSourcePosition(t1.pos, t1.length);

            node.AddChildLast(this.ParseAssignment());
            if (this.isSyntaxError) return node;

            t1 = this.GetToken();
            if (t1.type != eTokenType.ttCloseParanthesis)
            {
                this.Error();
            }

            node.UpdateSourcePosition(t1.pos, t1.length);
        }
        else
        {
            this.Error();
        }

        return node;
    }

    ParseCast(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snCast);

        let t1 = this.GetToken();
        if (t1.type != eTokenType.ttCast)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t1.pos, t1.length);

        t1 = this.GetToken();
        if (t1.type != eTokenType.ttLessThan)
        {
            this.Error();
            return node;
        }

        // Parse the data type
        node.AddChildLast(this.ParseType(true));
        if (this.isSyntaxError) return node;

        t1 = this.GetToken();
        if (t1.type != eTokenType.ttGreaterThan)
        {
            this.Error();
            return node;
        }

        t1 = this.GetToken();
        if (t1.type != eTokenType.ttOpenParanthesis)
        {
            this.Error();
            return node;
        }

        node.AddChildLast(this.ParseAssignment());
        if (this.isSyntaxError) return node;

        t1 = this.GetToken();
        if (t1.type != eTokenType.ttCloseParanthesis)
        {
            this.Error();
            return node;
        }

        node.UpdateSourcePosition(t1.pos, t1.length);

        return node;
    }

    ParseLambda(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snFunction);

        let t = this.GetToken();

        if (t.type != eTokenType.ttIdentifier || !this.IdentifierIs(t, FUNCTION_TOKEN))
        {
            this.Error();
            return node;
        }

        t = this.GetToken();
        if (t.type != eTokenType.ttOpenParanthesis)
        {
            this.Error();
            return node;
        }

        // Parse optional type before parameter name
        var isTypeResult = this.IsType();
        if (isTypeResult[0])// && (t.type == eTokenType.ttAmp || t.type == eTokenType.ttIdentifier))
        {
            node.AddChildLast(this.ParseType(true));
            if (this.isSyntaxError) return node;

            let typemod = this.ParseTypeMod(true);
            if (typemod)
            {
                node.AddChildLast(typemod);
            }

            if (this.isSyntaxError) return node;
        }

        t = this.GetToken();
        if (t.type == eTokenType.ttIdentifier)
        {
            this.RewindTo(t);
            node.AddChildLast(this.ParseIdentifier());
            if (this.isSyntaxError) return node;

            t = this.GetToken();
            while (t.type == eTokenType.ttListSeparator)
            {
                // Parse optional type before parameter name
                var isTypeResult = this.IsType();
                if (isTypeResult[0])// && (t.type == eTokenType.ttAmp || t.type == eTokenType.ttIdentifier)) 
                {
                    node.AddChildLast(this.ParseType(true));
                    if (this.isSyntaxError) return node;

                    let typemod = this.ParseTypeMod(true);
                    if (typemod)
                    {
                        node.AddChildLast(typemod);
                    }

                    if (this.isSyntaxError) return node;
                }

                node.AddChildLast(this.ParseIdentifier());
                if (this.isSyntaxError) return node;

                t = this.GetToken();
            }
        }

        if (t.type != eTokenType.ttCloseParanthesis)
        {
            this.Error();
            return node;
        }

        // We should just find the end of the statement block here. The statements
        // will be parsed on request by the compiler once it starts the compilation.
        node.AddChildLast(this.ParseStatementBlock());

        return node;
    }

    ParseConstructCall(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snConstructCall);

        node.AddChildLast(this.ParseType(false));
        if (this.isSyntaxError) return node;

        node.AddChildLast(this.ParseArgList());

        return node;
    }

    ParseFunctionCall(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snFunctionCall);

        // Parse scope prefix
        this.ParseOptionalScope(node);

        // Parse the function name followed by the argument list
        node.AddChildLast(this.ParseIdentifier());
        if (this.isSyntaxError) return node;

        node.AddChildLast(this.ParseArgList());

        return node;
    }

    ParseArgList(withParenthesis: boolean = true): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snArgList);

        let t1;
        if (withParenthesis)
        {
            t1 = this.GetToken();
            if (t1.type != eTokenType.ttOpenParanthesis)
            {
                this.Error();
                return node;
            }

            node.UpdateSourcePosition(t1.pos, t1.length);
        }

        t1 = this.GetToken();
        if (t1.type == eTokenType.ttCloseParanthesis || t1.type == eTokenType.ttCloseBracket)
        {
            if (withParenthesis)
            {
                if (t1.type == eTokenType.ttCloseParanthesis)
                    node.UpdateSourcePosition(t1.pos, t1.length);
                else
                {
                    this.Error();
                }
            }
            else
                this.RewindTo(t1);

            // Argument list has ended
            return node;
        }
        else
        {
            this.RewindTo(t1);

            for (; ;)
            {
                // Determine if this is a named argument
                let tl = this.GetToken();
                let t2 = this.GetToken();
                this.RewindTo(tl);

                // Named arguments uses the syntax: arg : expr
                // This avoids confusion when the argument has the same name as a local variable, i.e. var = expr
                // It also avoids conflict with expressions to that creates anonymous objects initialized with lists, i.e. type = {...}
                // The alternate syntax: arg = expr, is supported to provide backwards compatibility with 2.29.0
                // TODO: 3.0.0: Remove the alternate syntax
                if (tl.type == eTokenType.ttIdentifier && (t2.type == eTokenType.ttColon || (/*engine -> ep.alterSyntaxNamedArgs*/ true && t2.type == eTokenType.ttAssignment)))
                {
                    let named = this.CreateNode(eScriptNode.snNamedArgument);
                    node.AddChildLast(named);

                    named.AddChildLast(this.ParseIdentifier());
                    t2 = this.GetToken();

                    named.AddChildLast(this.ParseAssignment());
                }
                else
                    node.AddChildLast(this.ParseAssignment());

                if (this.isSyntaxError) return node;

                // Check if list continues
                t1 = this.GetToken();
                if (t1.type == eTokenType.ttListSeparator)
                    continue;
                else
                {
                    if (withParenthesis)
                    {
                        if (t1.type == eTokenType.ttCloseParanthesis)
                            node.UpdateSourcePosition(t1.pos, t1.length);
                        else
                        {
                            this.Error();
                        }
                    }
                    else
                        this.RewindTo(t1);

                    return node;
                }
            }
        }
    }

    ParseVariableAccess(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snVariableAccess);

        // Parse scope prefix
        this.ParseOptionalScope(node);

        // Parse the variable name
        node.AddChildLast(this.ParseIdentifier());

        return node;
    }

    ParseType(allowConst: boolean, allowVariableType: boolean = false, allowAuto: boolean = false)
    {
        let node = this.CreateNode(eScriptNode.snType);

        let token;

        if (allowConst)
        {
            token = this.GetToken();
            this.RewindTo(token);
            if (token.type == eTokenType.ttConst)
            {
                node.AddChildLast(this.ParseToken(eTokenType.ttConst));
                if (this.isSyntaxError) return node;
            }
        }

        // Parse scope prefix
        this.ParseOptionalScope(node);

        // Parse the actual type
        node.AddChildLast(this.ParseDataType(allowVariableType, allowAuto));
        if (this.isSyntaxError) return node;

        // Handle templates

        // If the datatype is a template type, then parse the subtype within the < >
        // token = this.GetToken();
        // this.RewindTo(token);
        // let type = node.lastChild;

        // tempString.Assign(&script->code[type->tokenPos], type->tokenLength);
        // if( engine->IsTemplateType(tempString.AddressOf()) && t.type == ttLessThan )
        // {
        // 	ParseTemplTypeList(node);
        // 	if (isSyntaxError) return node;
        // }

        // Parse [] and @
        token = this.GetToken();
        this.RewindTo(token);
        while (token.type == eTokenType.ttOpenBracket || token.type == eTokenType.ttHandle)
        {
            if (token.type == eTokenType.ttOpenBracket)
            {
                node.AddChildLast(this.ParseToken(eTokenType.ttOpenBracket));
                if (this.isSyntaxError) return node;

                token = this.GetToken();
                if (token.type != eTokenType.ttCloseBracket)
                {
                    this.Error();
                    return node;
                }
            }
            else
            {
                node.AddChildLast(this.ParseToken(eTokenType.ttHandle));
                if (this.isSyntaxError) return node;

                token = this.GetToken();
                this.RewindTo(token);
                if (token.type == eTokenType.ttConst)
                {
                    node.AddChildLast(this.ParseToken(eTokenType.ttConst));
                    if (this.isSyntaxError) return node;
                }
            }

            token = this.GetToken();
            this.RewindTo(token);
        }

        return node;
    }

    ParseConstant(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snConstant);

        let t = this.GetToken();
        if (!this.IsConstant(t.type))
        {
            this.Error();
            return node;
        }

        node.SetToken(t);

        // We want to gather a list of string constants to concatenate as children
        if (t.type == eTokenType.ttStringConstant || t.type == eTokenType.ttMultilineStringConstant || t.type == eTokenType.ttHeredocStringConstant)
            this.RewindTo(t);

        while (t.type == eTokenType.ttStringConstant || t.type == eTokenType.ttMultilineStringConstant || t.type == eTokenType.ttHeredocStringConstant)
        {
            node.AddChildLast(this.ParseStringConstant());

            t = this.GetToken();
            this.RewindTo(t);
        }

        return node;
    }

    ParseStringConstant(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snConstant);

        let t = this.GetToken();
        if (t.type != eTokenType.ttStringConstant && t.type != eTokenType.ttMultilineStringConstant && t.type != eTokenType.ttHeredocStringConstant)
        {
            this.Error();
            return node;
        }

        node.SetToken(t);

        return node;
    }

    ParseOptionalScope(node: ScriptNode)
    {
        let scope = this.CreateNode(eScriptNode.snScope);

        let t1 = this.GetToken();
        let t2 = this.GetToken();

        if (t1.type == eTokenType.ttScope)
        {
            this.RewindTo(t1);
            scope.AddChildLast(this.ParseToken(eTokenType.ttScope));
            t1 = this.GetToken();
            t2 = this.GetToken();
        }

        while (t1.type == eTokenType.ttIdentifier && t2.type == eTokenType.ttScope)
        {
            this.RewindTo(t1);
            scope.AddChildLast(this.ParseIdentifier());
            scope.AddChildLast(this.ParseToken(eTokenType.ttScope));
            t1 = this.GetToken();
            t2 = this.GetToken();
        }

        // Handle templates

        // The innermost scope may be a template type
        // if( t1.type == ttIdentifier && t2.type == ttLessThan )
        // {
        // 	tempString.Assign(&script->code[t1.pos], t1.length);
        // 	if (engine->IsTemplateType(tempString.AddressOf()))
        // 	{
        // 		RewindTo(&t1);
        // 		asCScriptNode *restore = scope->lastChild;
        // 		scope->AddChildLast(ParseIdentifier());
        // 		if (ParseTemplTypeList(scope, false))
        // 		{
        // 			GetToken(&t2);
        // 			if (t2.type == ttScope)
        // 			{
        // 				// Template type is part of the scope
        // 				// Nothing more needs to be done
        // 				node->AddChildLast(scope);
        // 				return;
        // 			}
        // 			else
        // 			{
        // 				// The template type is not part of the scope
        // 				// Rewind to the template type and end the scope
        // 				RewindTo(&t1);

        // 				// Restore the previously parsed node
        // 				while (scope->lastChild != restore)
        // 				{
        // 					asCScriptNode *last = scope->lastChild;
        // 					last->DisconnectParent();
        // 					last->Destroy(engine);
        // 				}
        // 				if( scope->lastChild )
        // 					node->AddChildLast(scope);
        // 				else
        // 					scope->Destroy(engine);
        // 				return;
        // 			}
        // 		}
        // 	}
        // }

        // The identifier is not part of the scope
        this.RewindTo(t1);

        if (scope.lastChild != null)
        {

            node.AddChildLast(scope);
        }
    }

    ParseDataType(allowVariableType: boolean = false, allowAuto: boolean = false): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snDataType);

        let token = this.GetToken();

        if (!this.IsDataType(token) && !(allowVariableType && token.type == eTokenType.ttQuestion) && !(allowAuto && token.type == eTokenType.ttAuto))
        {
            if (token.type == eTokenType.ttIdentifier)
            {
                this.Error();
            }
            else if (token.type == eTokenType.ttAuto)
            {
                this.Error();
            }
            else
            {
                this.Error();
            }

            return node;
        }

        node.SetToken(token);

        return node;
    }

    ParseTypeMod(isParam: boolean): ScriptNode | null
    {
        let node = this.CreateNode(eScriptNode.snTypemod);

        // Parse possible & token
        let token = this.GetToken();
        this.RewindTo(token);
        if (token.type == eTokenType.ttAmp)
        {
            node.AddChildLast(this.ParseToken(eTokenType.ttAmp));
            if (this.isSyntaxError) return node;

            if (isParam)
            {
                token = this.GetToken();
                this.RewindTo(token);

                if (token.type == eTokenType.ttIn || token.type == eTokenType.ttOut || token.type == eTokenType.ttInOut)
                {
                    let typeMods = [eTokenType.ttIn, eTokenType.ttOut, eTokenType.ttInOut];
                    node.AddChildLast(this.ParseOneOf(typeMods));
                }
            }
        }

        // Parse possible + token
        token = this.GetToken();
        this.RewindTo(token);
        if (token.type == eTokenType.ttPlus)
        {
            node.AddChildLast(this.ParseToken(eTokenType.ttPlus));
            if (this.isSyntaxError) return node;
        }

        // Parse possible if_handle_then_const token
        token = this.GetToken();
        this.RewindTo(token);
        if (this.IdentifierIs(token, IF_HANDLE_TOKEN))
        {
            node.AddChildLast(this.ParseToken(eTokenType.ttIdentifier));
            if (this.isSyntaxError) return node;
        }

        return null;
    }

    ParseExprOperator(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snExprOperator);

        let t = this.GetToken();
        if (!this.IsOperator(t.type))
        {
            this.Error();
            return node;
        }

        node.SetToken(t);
        return node;
    }

    ParseAssignOperator(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snExprOperator);

        let t = this.GetToken();
        if (!this.IsAssignOperator(t.type))
        {
            this.Error();
            return node;
        }

        node.SetToken(t);
        return node;
    }

    ParseIdentifier(): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snIdentifier);

        let token = this.GetToken();
        if (token.type != eTokenType.ttIdentifier)
        {
            this.Error();
            return node;
        }

        node.SetToken(token);
        return node;
    }

    ParseToken(tokenType: eTokenType): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snUndefined);

        let token = this.GetToken();
        if (token.type != tokenType)
        {
            this.Error();
            return node;
        }

        node.SetToken(token);
        return node;
    }

    ParseOneOf(tokens: eTokenType[]): ScriptNode
    {
        let node = this.CreateNode(eScriptNode.snUndefined);

        let token = this.GetToken();

        let n;
        for (n = 0; n < tokens.length; n++)
        {
            if (tokens[n] == token.type)
            {
                break;
            }
        }

        if (n == tokens.length)
        {
            this.Error();
            return node;
        }

        node.SetToken(token);
        return node;
    }

    IsDataType(token: Token): boolean
    {
        if (token.type == eTokenType.ttIdentifier)
        {
            // Something with builder-DoesTypeExist
            return false;
        }

        if (this.IsRealType(token.type))
            return true;

        return false;
    }

    IsRealType(tokenType: eTokenType): boolean
    {
        if (tokenType == eTokenType.ttVoid ||
            tokenType == eTokenType.ttInt ||
            tokenType == eTokenType.ttInt8 ||
            tokenType == eTokenType.ttInt16 ||
            tokenType == eTokenType.ttInt64 ||
            tokenType == eTokenType.ttUInt ||
            tokenType == eTokenType.ttUInt8 ||
            tokenType == eTokenType.ttUInt16 ||
            tokenType == eTokenType.ttUInt64 ||
            tokenType == eTokenType.ttFloat ||
            tokenType == eTokenType.ttBool ||
            tokenType == eTokenType.ttDouble)
            return true;

        return false;
    }

    IsVarDecl(): boolean
    {
        // Set start point so that we can rewind
        let t = this.GetToken();
        this.RewindTo(t);

        // A class property decl can be preceded by 'private' or 'protected'
        let t1 = this.GetToken();
        if (t1.type != eTokenType.ttPrivate && t1.type != eTokenType.ttProtected)
        {
            this.RewindTo(t1);
        }

        // A variable decl starts with the type
        var isTypeResult = this.IsType();
        if (!isTypeResult[0])
        {
            this.RewindTo(t);
            return false;
        }

        if (isTypeResult[1] != null)
        {
            t1 = isTypeResult[1];
        }

        // Jump to the token after the type
        this.RewindTo(t1);
        t1 = this.GetToken();

        // The declaration needs to have a name
        if (t1.type != eTokenType.ttIdentifier)
        {
            this.RewindTo(t);
            return false;
        }

        // It can be followed by an initialization
        t1 = this.GetToken();
        if (t1.type == eTokenType.ttEndStatement || t1.type == eTokenType.ttAssignment || t1.type == eTokenType.ttListSeparator)
        {
            this.RewindTo(t);
            return true;
        }
        if (t1.type == eTokenType.ttOpenParanthesis)
        {
            // If the closing parenthesis is followed by a statement block, 
            // function decorator, or end-of-file, then treat it as a function. 
            // A function decl may have nested parenthesis so we need to check 
            // for this too.
            let nest = 0;
            while (t1.type != eTokenType.ttEnd)
            {
                if (t1.type == eTokenType.ttOpenParanthesis)
                {
                    nest++;
                }
                else if (t1.type == eTokenType.ttCloseParanthesis)
                {
                    nest--;
                    if (nest == 0)
                    {
                        break;
                    }
                }
                t1 = this.GetToken();
            }

            if (t1.type == eTokenType.ttEnd)
            {
                this.RewindTo(t);
                return false;
            }
            else
            {
                t1 = this.GetToken();
                this.RewindTo(t);
                if (t1.type == eTokenType.ttStartStatementBlock ||
                    t1.type == eTokenType.ttIdentifier || // function decorator
                    t1.type == eTokenType.ttEnd)
                    return false;
            }

            this.RewindTo(t);
            return true;
        }

        this.RewindTo(t);
        return false;
    }

    // nextToken is only modified if the current position can be interpreted as
    // type, in this case it is set to the next token after the type tokens
    IsType(): [boolean, Token | null]
    {
        // Set a rewind point
        let t = this.GetToken();

        // A type can start with a const
        let t1 = t;
        if (t1.type == eTokenType.ttConst)
            t1 = this.GetToken();

        let t2;
        if (t1.type != eTokenType.ttAuto)
        {
            // The type may be initiated with the scope operator
            if (t1.type == eTokenType.ttScope)
                t1 = this.GetToken();

            // The type may be preceded with a multilevel scope
            t2 = this.GetToken();
            while (t1.type == eTokenType.ttIdentifier)
            {
                if (t2.type == eTokenType.ttScope)
                {
                    t1 = this.GetToken();
                    t2 = this.GetToken();
                    continue;
                }
                else if (t2.type == eTokenType.ttLessThan)
                {
                    // Template types can also be used as scope identifiers
                    this.RewindTo(t2);
                    if (this.CheckTemplateType(t1))
                    {
                        let t3 = this.GetToken();
                        if (t3.type == eTokenType.ttScope)
                        {
                            t1 = this.GetToken();
                            t2 = this.GetToken();
                            continue;
                        }
                    }
                }

                break;
            }

            this.RewindTo(t2);
        }

        // We don't validate if the identifier is an actual declared type at this moment
        // as it may wrongly identify the statement as a non-declaration if the user typed
        // the name incorrectly. The real type is validated in ParseDeclaration where a
        // proper error message can be given.
        if (!this.IsRealType(t1.type) && t1.type != eTokenType.ttIdentifier && t1.type != eTokenType.ttAuto)
        {
            this.RewindTo(t);
            return [false, null];
        }

        if (!this.CheckTemplateType(t1))
        {
            this.RewindTo(t);
            return [false, null];
        }

        // Object handles can be interleaved with the array brackets
        // Even though declaring variables with & is invalid we'll accept
        // it here to give an appropriate error message later
        t2 = this.GetToken();
        while (t2.type == eTokenType.ttHandle || t2.type == eTokenType.ttAmp || t2.type == eTokenType.ttOpenBracket)
        {
            if (t2.type == eTokenType.ttHandle)
            {
                // A handle can optionally be read-only
                let t3 = this.GetToken();
                if (t3.type != eTokenType.ttConst)
                    this.RewindTo(t3);
            }
            else if (t2.type == eTokenType.ttOpenBracket)
            {
                t2 = this.GetToken();
                if (t2.type != eTokenType.ttCloseBracket)
                {
                    this.RewindTo(t);
                    return [false, null];
                }
            }

            t2 = this.GetToken();
        }

        // Rewind to start point
        this.RewindTo(t);

        return [true, t2];
    }

    IsOperator(tokenType: eTokenType): boolean
    {
        if (tokenType == eTokenType.ttPlus ||
            tokenType == eTokenType.ttMinus ||
            tokenType == eTokenType.ttStar ||
            tokenType == eTokenType.ttSlash ||
            tokenType == eTokenType.ttPercent ||
            tokenType == eTokenType.ttStarStar ||
            tokenType == eTokenType.ttAnd ||
            tokenType == eTokenType.ttOr ||
            tokenType == eTokenType.ttXor ||
            tokenType == eTokenType.ttEqual ||
            tokenType == eTokenType.ttNotEqual ||
            tokenType == eTokenType.ttLessThan ||
            tokenType == eTokenType.ttLessThanOrEqual ||
            tokenType == eTokenType.ttGreaterThan ||
            tokenType == eTokenType.ttGreaterThanOrEqual ||
            tokenType == eTokenType.ttAmp ||
            tokenType == eTokenType.ttBitOr ||
            tokenType == eTokenType.ttBitXor ||
            tokenType == eTokenType.ttBitShiftLeft ||
            tokenType == eTokenType.ttBitShiftRight ||
            tokenType == eTokenType.ttBitShiftRightArith ||
            tokenType == eTokenType.ttIs ||
            tokenType == eTokenType.ttNotIs)
            return true;

        return false;
    }

    IsAssignOperator(tokenType: eTokenType): boolean
    {
        if (tokenType == eTokenType.ttAssignment ||
            tokenType == eTokenType.ttAddAssign ||
            tokenType == eTokenType.ttSubAssign ||
            tokenType == eTokenType.ttMulAssign ||
            tokenType == eTokenType.ttDivAssign ||
            tokenType == eTokenType.ttModAssign ||
            tokenType == eTokenType.ttPowAssign ||
            tokenType == eTokenType.ttAndAssign ||
            tokenType == eTokenType.ttOrAssign ||
            tokenType == eTokenType.ttXorAssign ||
            tokenType == eTokenType.ttShiftLeftAssign ||
            tokenType == eTokenType.ttShiftRightLAssign ||
            tokenType == eTokenType.ttShiftRightAAssign)
            return true;

        return false;
    }

    IsPreOperator(tokenType: eTokenType): boolean
    {
        if (tokenType == eTokenType.ttMinus ||
            tokenType == eTokenType.ttPlus ||
            tokenType == eTokenType.ttNot ||
            tokenType == eTokenType.ttInc ||
            tokenType == eTokenType.ttDec ||
            tokenType == eTokenType.ttBitNot ||
            tokenType == eTokenType.ttHandle)
            return true;
        return false;
    }

    IsPostOperator(tokenType: eTokenType): boolean
    {
        if (tokenType == eTokenType.ttInc ||            // post increment
            tokenType == eTokenType.ttDec ||            // post decrement
            tokenType == eTokenType.ttDot ||            // member access
            tokenType == eTokenType.ttOpenBracket ||    // index operator
            tokenType == eTokenType.ttOpenParanthesis) // argument list for call on function pointer
            return true;
        return false;
    }

    IsConstant(tokenType: eTokenType): boolean
    {
        if (tokenType == eTokenType.ttIntConstant ||
            tokenType == eTokenType.ttFloatConstant ||
            tokenType == eTokenType.ttDoubleConstant ||
            tokenType == eTokenType.ttStringConstant ||
            tokenType == eTokenType.ttMultilineStringConstant ||
            tokenType == eTokenType.ttHeredocStringConstant ||
            tokenType == eTokenType.ttTrue ||
            tokenType == eTokenType.ttFalse ||
            tokenType == eTokenType.ttBitsConstant ||
            tokenType == eTokenType.ttNull)
            return true;

        return false;
    }

    IsFunctionCall(): boolean
    {
        let s = this.GetToken();
        let t1 = s;

        // A function call may be prefixed with scope resolution
        if (t1.type == eTokenType.ttScope)
            t1 = this.GetToken();

        let t2 = this.GetToken();

        while (t1.type == eTokenType.ttIdentifier && t2.type == eTokenType.ttScope)
        {
            t1 = this.GetToken();
            t2 = this.GetToken();
        }

        // A function call starts with an identifier followed by an argument list
        // The parser doesn't have enough information about scope to determine if the
        // identifier is a datatype, so even if it happens to be the parser will
        // identify the expression as a function call rather than a construct call.
        // The compiler will sort this out later
        if (t1.type != eTokenType.ttIdentifier)
        {
            this.RewindTo(s);
            return false;
        }

        if (t2.type == eTokenType.ttOpenParanthesis)
        {
            this.RewindTo(s);
            return true;
        }

        this.RewindTo(s);
        return false;
    }

    IsLambda(): boolean
    {
        let isLambda = false;
        let t = this.GetToken();

        if (t.type == eTokenType.ttIdentifier && this.IdentifierIs(t, FUNCTION_TOKEN))
        {
            let t2 = this.GetToken();
            if (t2.type == eTokenType.ttOpenParanthesis)
            {
                // Skip until )
                while (t2.type != eTokenType.ttCloseParanthesis && t2.type != eTokenType.ttEnd)
                    t2 = this.GetToken();

                // The next token must be a {
                t2 = this.GetToken();
                if (t2.type == eTokenType.ttStartStatementBlock)
                    isLambda = true;
            }
        }

        this.RewindTo(t);

        return isLambda;
    }

    CheckTemplateType(t: Token): boolean
    {
        // Is this a template type?
        return true;
    }

    Error()
    {
        console.log("There was an error");
        this.isSyntaxError = true;
    }

}