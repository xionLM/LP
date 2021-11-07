#!/usr/bin/env node

/*
作者:霓虹派
github:xionlm
作品:Language processor(LP)
* */
const fs = require("fs");
const join = require("path").join
const argv = process.argv;
const execSync  = require('child_process').execSync;

let id = 1
let fileList = []
let mode = "c"
let config= require(join(process.cwd(), "config.json"))

const macro = {
    m: 0,
    firstMacroSymbol: false,
    firstMacroSymbolPosition: false,
    leftTokens: [],
    rightTokens: [],
    templateIndex: [],
    matchIndex: [],
    endPosition: false,
    initOrReset: function() {
        macro.m = 0
        macro.firstMacroSymbol = false
        macro.firstMacroSymbolPosition = false
        macro.leftTokens = []
        macro.rightTokens = []
        macro.templateIndex = []
        macro.matchIndex = []
    },
    add: function(token) {
        if (macro.firstMacroSymbol === false) {
            if (token.type === "macro") {
                macro.firstMacroSymbol = token.value
                macro.firstMacroSymbolPosition = macro.m
                macro.m = -1
            } else {
                macro.leftTokens.push(token)
            }
        } else {
            macro.rightTokens.push(token)
        }
        macro.m++
    },
    getType: function() {
        return macro.firstMacroSymbol
    },
    matchEndPosition: function(tokens, paragraphStartPosition, u, firstMacroSymbolPosition) {
        let undefineTokens = [].concat(
            tokens.slice(paragraphStartPosition, firstMacroSymbolPosition), {
                "value": "<-",
                "type": "macro",
                "line": tokens[firstMacroSymbolPosition].line,
                "column": tokens[firstMacroSymbolPosition].column,
            }, tokens.slice(firstMacroSymbolPosition + 1, u)
        )
        let undefinePosition = tokens.length
        for (; u < tokens.length; u++) {
            let di = 0,
                ti = u;
            for (; tokens[ti].type === undefineTokens[di].type && tokens[ti].value === undefineTokens[di].value;) {
                ti++;
                di++;
                if (di === undefineTokens.length) {
                    return u
                }
            }
        }
        return undefinePosition
    },
    match: function(tokens, startPosition) {
        if (macro.leftTokens.length === 0) {
            return
        } else if (macro.leftTokens.length > 1) {
            macro.leftTokens = macro.leftTokens.slice(0, -1)
        }
        if (macro.rightTokens.length > 1) {
            macro.rightTokens = macro.rightTokens.slice(1)
        }
        i = startPosition
        for (; i < macro.endPosition;) {
            let m = 0
            let t = i
            let matchReturn = []
            let matchIndexStartPosition = i
            if (macro.leftTokens[0].type === "spread") {
                let tokensReverse = tokens.slice(0, i).reverse();
                matchReturn = macro.tokenMatch(tokens[i], tokensReverse, i)
                if (matchReturn) {
                    [t, macro.templateIndex] = matchReturn
                    m++
                    matchIndexStartPosition = t
                } else {
                    break
                }
            }
            for (; t < macro.endPosition;) {
                if (macro.leftTokens[m].type !== "spread" && tokens[t].type === "spread") {
                    matchReturn = this.tokenMatch(tokens[t], macro.leftTokens, m)
                    if (matchReturn !== false) {
                        [m, macro.templateIndex] = matchReturn
                    } else {
                        break
                    }
                } else {
                    matchReturn = macro.tokenMatch(macro.leftTokens[m], tokens, t)
                    if (matchReturn !== false) {
                        [t, macro.templateIndex] = matchReturn
                    } else {
                        break
                    }
                }
                t++
                m++
                if (m === macro.leftTokens.length) {
                    i = t - 1
                    macro.matchIndex.push({
                        start: matchIndexStartPosition,
                        end: t,
                        templateIndex: macro.templateIndex
                    })
                    break
                }
            }
            i++
        }
        return macro.matchIndex
    },
    matchExpressionEndPosition: function(tokens, startPosition) {
        let openCount = 0;
        let closeCount = 0;
        for (let i = startPosition; i < tokens.length; i++) {
            if (tokens[i].value === '(') {
                closeCount++
            } else if (tokens[i].value === ')') {
                closeCount++
                if (closeCount === openCount) {
                    return i + 1
                }
            }
        }
        return false

    },
    tokenMatch: function(tokenA, tokenB, b) {
        let tokenASpread;
        let a = 0;
        if (tokenA.type === 'spread') {
            tokenASpread = tokenA.value
        } else {
            tokenASpread = [tokenA]
        }
        for (; b < tokenB.length;) {
            if (tokenASpread[a].type === "spread") {
                let tokenMatchReturn = macro.tokenMatch(tokenASpread[a], tokenB, b)
                if (tokenMatchReturn) {
                    [b, macro.templateIndex] = tokenMatchReturn
                } else {
                    return false
                }
            } else if (['symbol', 'space', 'nextline'].indexOf(tokenASpread[a].type) !== -1) {
                if (tokenASpread[a].type !== tokenB[b].type || tokenASpread[a].value !== tokenB[b].value) {
                    return false;
                }
            } else if (tokenASpread[a].type === 'template') {
                let templateBody = tokenASpread[a].value.body
                if (templateBody.length === 0) {
                    let nb = macro.matchExpressionEndPosition(tokenB, b)
                    if (tokenB[b].value === '(' && nb) {
                        macro.templateIndex[tokenASpread[a].value.name] = [tokenB.slice(b, nb)]
                        b = nb
                    } else {
                        macro.templateIndex[tokenASpread[a].value.name] = [tokenB[b]]
                    }
                } else if (templateBody.map(value => value.value).indexOf(tokenB[b].value) !== -1) {
                    macro.templateIndex[tokenASpread[a].value.name] = tokenB[b]
                } else {
                    return false;
                }
            }
            a++;
            if (tokenA.type !== 'spread') {
                return [b, macro.templateIndex]
            }
            if (a === tokenASpread.length) {
                if (!tokenA.endSymbol) {
                    b = tokenB.length
                    return [b, macro.templateIndex]
                } else {
                    if (b + 2 >= tokenB.length) {
                        return false
                    } else if (tokenB[b + 1].type === 'space' && tokenA.endSymbol === tokenB[b + 2].value) {
                        return [b, macro.templateIndex]
                    } else {
                        a = 0
                        b++
                    }
                }
            }
            b++
        }
    },
    replace: function macroReplace(tokens) {
        let offset = 0;
        for (let i of macro.matchIndex) {
            let tokensReplacement = macro.rightTokens.map(value => {
                if (value.type === 'template' && value.value.name.length > 0) {
                    if (macro.templateIndex[value.value.name] === null) {
                        errorInfo(false, "Invalid template index value.")
                    } else {
                        return macro.templateIndex[value.value.name]
                    }
                } else {
                    return value
                }
            })
            let start = i.start + offset
            let end = i.end + offset
            if (macro.getType() === "->") {
                tokens = [].concat(tokens.slice(0, start), tokensReplacement, tokens.slice(end))
                offset += tokensReplacement.length - i.end + i.start
            } else if (macro.getType() === "<->") {
                let endSymbol = false
                if (end + 1 >= tokens.length) {
                    continue
                }
                if (tokens[end + 1].type !== 'macro') {
                    endSymbol = tokens[end + 1].value
                }
                tokens = [].concat(
                    tokens.slice(0, start), {
                        type: "spread",
                        value: tokensReplacement,
                        endSymbol: endSymbol,
                        line: tokens[start].line,
                        column: tokens[start].column,
                    },
                    tokens.slice(end)
                )
                offset += start - 1 - i.end + i.start
            }
        }
        return tokens
    }
};

const template = {
    startPosition: false,
    startSymbolToken: [],
    state: false,
    name: "",
    body: [],
    initOrReset: function() {
        template.startPosition = false
        template.startSymbolToken = []
        template.state = false
        template.name = ""
        template.body = []
    },
    addName: function(name) {
        template.name += name
    },
    addBody: function(body) {
        template.body.push(body)
    },
    setState: function(state) {
        template.state = state
    },
    getState: function() {
        return template.state
    },
    replace: function(macroTokens) {
        if (template.name.length === 0) {
            templateName = template.name
        } else if (template.name.length > 0) {
            templateName = template.name.replace(/\s$/g, '')
        }
        return [].concat(
            macroTokens.slice(0, template.startPosition), {
                id: template.startSymbolToken.id,
                type: "template",
                value: {
                    name: templateName,
                    body: template.body,
                },
                line: template.startSymbolToken.line,
                column: template.startSymbolToken.column
            }
        )
    }
};

;
(function main() {
    let sourceFilename = false
    if (argv[2]!==undefined) {
        sourceFilename = argv[2]
        if (sourceFilename.search(/.lp$/) === -1) {
            sourceFilename += '.lp'
        }
        sourceFilename=isExist(sourceFilename)
    }
    if (sourceFilename) {
        if (argv[3]!==undefined && argv[3].search(/^(c|r|c&r)$/) !== -1) {
            mode = argv[3]
        }
        let sourceCode = fs.readFileSync(sourceFilename, "utf-8")
        fileList = [sourceFilename]
        let sourceTokens = scanner(sourceCode)
        let targetTokens = parser(sourceTokens)
        let targetCode = transformer(targetTokens)
        let targetFilename = sourceFilename.slice(0, -3) + "." + config.suffix;
        fs.writeFileSync(targetFilename, targetCode, "utf-8")
        if (mode === "r" ) {
            execSync(config.executor + " " + targetFilename, {
                stdio: 'inherit',
            });
        }
    } 
})()

function errorInfo(errorToken, string) {
    if (errorToken === false) {
        console.log(string);
    } else {
        console.log("[" + errorToken.line + ":" + errorToken.column + "]" + string);
    }
    process.exit(0)
}

function newline() {
    if (process.platform === "win32") {
        return "\r\n"
    } else if (process.platform === "darwin") {
        return "\r"
    } else {
        return "\n"
    }
}


function isExist(filename) {
    const joinSymbol = join(' ', ' ').slice(1, -1)
    filename = filename.replace(joinSymbol.repeat(2), ":" + joinSymbol.repeat(2))
    if (filename.search(/\.lp$/) === -1) {
        filename += '.lp'
    }
    if (fs.statSync(filename) ?.isFile()) {
        return filename
    } else {
        errorInfo(false, sourceFilename + " no exist.")
    }
}

function tokenPush(code, tokens, value, type, line, column, fileList) {
    let fileListString = fileList.join("|")
    tokens.push({
        "id": id,
        "value": value,
        "type": type,
        "line": line,
        "column": column,
        "file": fileListString,
    })
    id++
    code = code.replace(value, "")
    return [code, tokens]
}

function scanner(code) {
    let line = 1,
        column = 1;
    let tokens = []
    for (; code.length > 0;) {
        let symbolString = code.match(/^\S+/)
        let includeString = code.match(/^#\s\S+/)
        if (includeString !== null) {
            code = code.replace(includeString[0], "")
            includeString = includeString[0].slice(2)
            includeString=isExist(includeString)
            includeCode = fs.readFileSync(includeString, "utf-8")
            includeToken = scanner(includeCode)
            tokens = [].concat(tokens, includeToken)
        } else if (code.indexOf(newline()) === 0) {
            [code, tokens] = tokenPush(code, tokens, newline(), "newline", line, column, fileList)
            line++
            column = 1
        } else if (code.indexOf(" ") === 0) {
            [code, tokens] = tokenPush(code, tokens, " ", "space", line, column, fileList)
            column++
        } else if (symbolString !== null) {
            let tokensType
            if (["->", "<-", "<->"].indexOf(symbolString[0]) !== -1) {
                tokensType = "macro"
            } else if (symbolString[0] === "'") {
                tokensType = "quote"
            } else {
                tokensType = "symbol"
            }
            [code, tokens] = tokenPush(code, tokens, symbolString[0], tokensType, line, column, fileList)
            column += symbolString[0].length
        }
    }
    return tokens
}

function parser(tokens) {
    let inQuote = false
    let paragraphStartPosition = 0
    let firstMacroSymbolPosition = false
    let p = 0
    for (; p < tokens.length;) {
        if (tokens[p].type === "quote") {
            inQuote = !inQuote
            p += 2
            continue
        }
        if (!inQuote) {
            if (tokens[p].type === "macro") {
                macro.firstMacroSymbol === false && template.getState() !== false && errorInfo(tokens[p], "The template no end")
                firstMacroSymbolPosition = p
            } else if (template.getState() === "name" && tokens[p].value === ":") {
                template.setState("body")
                p += 2
                continue
            } else if (template.getState() === "body" && tokens[p].type === "space") {
                p++
                continue
            } else if (tokens[p].value === "{") {
                template.setState("name")
                template.startPosition = macro.m
                template.startSymbolToken = tokens[p]
                p += 2
                continue
            } else if (tokens[p].value === "}") {
                !template.getState() && errorInfo(tokens[p], "Template is missing start symbol")
                if (macro.firstMacroSymbol === false) {
                    macro.leftTokens = template.replace(macro.leftTokens)
                } else {
                    macro.rightTokens = template.replace(macro.rightTokens)
                }
                template.initOrReset()
                p++
                continue
            } else if (tokens[p].type === "newline") {
                if (macro.getType() === "->" || macro.getType() === "<->") {
                    macro.endPosition = macro.matchEndPosition(tokens, paragraphStartPosition, p, firstMacroSymbolPosition)
                    let macroMatchIndex = macro.match(tokens, p + 1)
                    if (macroMatchIndex.length > 0) {
                        tokens = macro.replace(tokens, macroMatchIndex)
                    }
                    tokens = [].concat(tokens.slice(0, paragraphStartPosition), tokens.slice(p))
                    p = paragraphStartPosition
                }
                if (p + 1 < tokens.length) {
                    paragraphStartPosition = p + 1
                }
                macro.initOrReset()
                p++;
                continue
            }
        }
        template.getState() === 'name' && template.addName(tokens[p].value)
        template.getState() === 'body' && template.addBody(tokens[p])
        macro.add(tokens[p])
        p++
    }
    return tokens
}

function transformer(tokens) {
    let code = ""
    for (i of tokens) {
        if (['symbol', 'space', 'newline'].indexOf(i.type) === -1) {
            errorInfo(i, "Unresolved token")
        }
        code += i.value
    }
    return code
}