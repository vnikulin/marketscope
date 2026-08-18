import { matchesExactPhrase, matchesLooseTerm } from './terms.js';
import { normalizeText } from './text.js';

const MAX_EXPRESSION_LENGTH = 1_000;
const MAX_AST_DEPTH = 20;

type TokenType = 'AND' | 'EOF' | 'LPAREN' | 'NOT' | 'OR' | 'RPAREN' | 'TERM';

interface Token {
  type: TokenType;
  value: string;
  offset: number;
  quoted: boolean;
}

export type BooleanAst =
  | {
      type: 'TERM';
      value: string;
      exactPhrase: boolean;
    }
  | {
      type: 'NOT';
      operand: BooleanAst;
    }
  | {
      type: 'AND' | 'OR';
      left: BooleanAst;
      right: BooleanAst;
    };

export interface BooleanParseError {
  message: string;
  offset: number;
}

export type BooleanParseResult =
  { ok: true; ast: BooleanAst } | { ok: false; error: BooleanParseError };

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;

  while (offset < expression.length) {
    const character = expression[offset];
    if (character === undefined) {
      break;
    }

    if (/\s/u.test(character)) {
      offset += 1;
      continue;
    }

    if (character === '(' || character === ')') {
      tokens.push({
        type: character === '(' ? 'LPAREN' : 'RPAREN',
        value: character,
        offset,
        quoted: false,
      });
      offset += 1;
      continue;
    }

    if (character === '"') {
      const start = offset;
      let value = '';
      let closed = false;
      offset += 1;

      while (offset < expression.length) {
        const quotedCharacter = expression[offset];
        if (quotedCharacter === '\\') {
          const escapedCharacter = expression[offset + 1];
          if (escapedCharacter === undefined) {
            break;
          }
          value += escapedCharacter;
          offset += 2;
          continue;
        }
        if (quotedCharacter === '"') {
          closed = true;
          offset += 1;
          break;
        }
        if (quotedCharacter !== undefined) {
          value += quotedCharacter;
        }
        offset += 1;
      }

      if (!closed) {
        throw new ParseFailure('Unterminated quoted phrase', start);
      }
      if (value.trim().length === 0) {
        throw new ParseFailure('Quoted phrase cannot be empty', start);
      }

      tokens.push({
        type: 'TERM',
        value,
        offset: start,
        quoted: true,
      });
      continue;
    }

    const start = offset;
    while (offset < expression.length) {
      const termCharacter = expression[offset];
      if (
        termCharacter === undefined ||
        /\s/u.test(termCharacter) ||
        termCharacter === '(' ||
        termCharacter === ')'
      ) {
        break;
      }
      offset += 1;
    }

    const value = expression.slice(start, offset);
    const operator = value.toUpperCase();
    const type: TokenType =
      operator === 'AND' || operator === 'OR' || operator === 'NOT'
        ? operator
        : 'TERM';
    tokens.push({ type, value, offset: start, quoted: false });
  }

  tokens.push({
    type: 'EOF',
    value: '',
    offset: expression.length,
    quoted: false,
  });
  return tokens;
}

interface ParsedNode {
  ast: BooleanAst;
  depth: number;
}

class BooleanParser {
  private cursor = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): BooleanAst {
    const parsed = this.parseOr();
    const trailingToken = this.current();
    if (trailingToken.type !== 'EOF') {
      throw new ParseFailure(
        `Unexpected token "${trailingToken.value}"`,
        trailingToken.offset,
      );
    }
    return parsed.ast;
  }

  private current(): Token {
    const token = this.tokens[this.cursor];
    if (token === undefined) {
      throw new ParseFailure('Unexpected end of expression', 0);
    }
    return token;
  }

  private advance(): Token {
    const token = this.current();
    this.cursor += 1;
    return token;
  }

  private parseOr(): ParsedNode {
    let left = this.parseAnd();
    while (this.current().type === 'OR') {
      const operator = this.advance();
      const right = this.parseAnd();
      left = this.binary('OR', left, right, operator.offset);
    }
    return left;
  }

  private parseAnd(): ParsedNode {
    let left = this.parseNot();
    while (this.current().type === 'AND') {
      const operator = this.advance();
      const right = this.parseNot();
      left = this.binary('AND', left, right, operator.offset);
    }
    return left;
  }

  private parseNot(): ParsedNode {
    if (this.current().type !== 'NOT') {
      return this.parsePrimary();
    }

    const operator = this.advance();
    const operand = this.parseNot();
    const depth = operand.depth + 1;
    this.assertDepth(depth, operator.offset);
    return {
      ast: { type: 'NOT', operand: operand.ast },
      depth,
    };
  }

  private parsePrimary(): ParsedNode {
    const token = this.current();
    if (token.type === 'TERM') {
      this.advance();
      return {
        ast: {
          type: 'TERM',
          value: token.value,
          exactPhrase: token.quoted,
        },
        depth: 1,
      };
    }

    if (token.type === 'LPAREN') {
      this.advance();
      const parsed = this.parseOr();
      const closing = this.current();
      if (closing.type !== 'RPAREN') {
        throw new ParseFailure('Expected closing parenthesis', closing.offset);
      }
      this.advance();
      return parsed;
    }

    throw new ParseFailure(
      'Expected a term or opening parenthesis',
      token.offset,
    );
  }

  private binary(
    type: 'AND' | 'OR',
    left: ParsedNode,
    right: ParsedNode,
    offset: number,
  ): ParsedNode {
    const depth = Math.max(left.depth, right.depth) + 1;
    this.assertDepth(depth, offset);
    return {
      ast: { type, left: left.ast, right: right.ast },
      depth,
    };
  }

  private assertDepth(depth: number, offset: number): void {
    if (depth > MAX_AST_DEPTH) {
      throw new ParseFailure(
        `Boolean expression exceeds depth ${MAX_AST_DEPTH}`,
        offset,
      );
    }
  }
}

export function parseBooleanExpression(expression: string): BooleanParseResult {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    return {
      ok: false,
      error: {
        message: `Boolean expression exceeds ${MAX_EXPRESSION_LENGTH} characters`,
        offset: MAX_EXPRESSION_LENGTH,
      },
    };
  }

  try {
    const ast = new BooleanParser(tokenize(expression)).parse();
    return { ok: true, ast };
  } catch (error) {
    if (error instanceof ParseFailure) {
      return {
        ok: false,
        error: { message: error.message, offset: error.offset },
      };
    }

    return {
      ok: false,
      error: { message: 'Unable to parse Boolean expression', offset: 0 },
    };
  }
}

function evaluateNormalized(ast: BooleanAst, normalizedText: string): boolean {
  switch (ast.type) {
    case 'TERM':
      return ast.exactPhrase
        ? matchesExactPhrase(normalizedText, ast.value)
        : matchesLooseTerm(normalizedText, ast.value);
    case 'NOT':
      return !evaluateNormalized(ast.operand, normalizedText);
    case 'AND':
      return (
        evaluateNormalized(ast.left, normalizedText) &&
        evaluateNormalized(ast.right, normalizedText)
      );
    case 'OR':
      return (
        evaluateNormalized(ast.left, normalizedText) ||
        evaluateNormalized(ast.right, normalizedText)
      );
  }
}

export function evaluateBooleanAst(ast: BooleanAst, text: string): boolean {
  return evaluateNormalized(ast, normalizeText(text));
}
