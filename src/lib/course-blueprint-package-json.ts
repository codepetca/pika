export type StrictJsonParseResult = {
  value: unknown
  topLevelValueText: ReadonlyMap<string, string>
}

export class StrictJsonError extends Error {
  constructor(
    message: string,
    readonly kind: 'syntax' | 'duplicate_key',
  ) {
    super(message)
  }
}

class StrictJsonScanner {
  private index = 0
  private readonly topLevelValueText = new Map<string, string>()

  constructor(private readonly source: string) {}

  parse(): StrictJsonParseResult {
    this.skipWhitespace()
    this.parseValue(true)
    this.skipWhitespace()
    if (this.index !== this.source.length) this.syntaxError()

    let value: unknown
    try {
      value = JSON.parse(this.source)
    } catch {
      this.syntaxError()
    }
    return { value, topLevelValueText: this.topLevelValueText }
  }

  private parseValue(captureTopLevelObject = false) {
    const token = this.source[this.index]
    if (token === '{') return this.parseObject(captureTopLevelObject)
    if (token === '[') return this.parseArray()
    if (token === '"') {
      this.parseString()
      return
    }
    if (token === 't') return this.parseLiteral('true')
    if (token === 'f') return this.parseLiteral('false')
    if (token === 'n') return this.parseLiteral('null')
    if (token === '-' || (token >= '0' && token <= '9')) return this.parseNumber()
    this.syntaxError()
  }

  private parseObject(captureValues: boolean) {
    this.index += 1
    this.skipWhitespace()
    if (this.source[this.index] === '}') {
      this.index += 1
      return
    }

    const keys = new Set<string>()
    while (this.index < this.source.length) {
      if (this.source[this.index] !== '"') this.syntaxError()
      const key = this.parseString()
      if (keys.has(key)) {
        throw new StrictJsonError(`Duplicate JSON key "${key}"`, 'duplicate_key')
      }
      keys.add(key)
      this.skipWhitespace()
      if (this.source[this.index] !== ':') this.syntaxError()
      this.index += 1
      this.skipWhitespace()
      const valueStart = this.index
      this.parseValue()
      if (captureValues) {
        this.topLevelValueText.set(key, this.source.slice(valueStart, this.index))
      }
      this.skipWhitespace()
      const separator = this.source[this.index]
      if (separator === '}') {
        this.index += 1
        return
      }
      if (separator !== ',') this.syntaxError()
      this.index += 1
      this.skipWhitespace()
    }
    this.syntaxError()
  }

  private parseArray() {
    this.index += 1
    this.skipWhitespace()
    if (this.source[this.index] === ']') {
      this.index += 1
      return
    }
    while (this.index < this.source.length) {
      this.parseValue()
      this.skipWhitespace()
      const separator = this.source[this.index]
      if (separator === ']') {
        this.index += 1
        return
      }
      if (separator !== ',') this.syntaxError()
      this.index += 1
      this.skipWhitespace()
    }
    this.syntaxError()
  }

  private parseString(): string {
    const start = this.index
    this.index += 1
    while (this.index < this.source.length) {
      const character = this.source[this.index]
      if (character === '"') {
        this.index += 1
        try {
          return JSON.parse(this.source.slice(start, this.index)) as string
        } catch {
          this.syntaxError()
        }
      }
      if (character === '\\') {
        this.index += 1
        const escape = this.source[this.index]
        if (escape === 'u') {
          const hex = this.source.slice(this.index + 1, this.index + 5)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.syntaxError()
          this.index += 5
          continue
        }
        if (!escape || !'"\\/bfnrt'.includes(escape)) this.syntaxError()
        this.index += 1
        continue
      }
      if (character.charCodeAt(0) < 0x20) this.syntaxError()
      this.index += 1
    }
    this.syntaxError()
  }

  private parseLiteral(literal: string) {
    if (this.source.slice(this.index, this.index + literal.length) !== literal) {
      this.syntaxError()
    }
    this.index += literal.length
  }

  private parseNumber() {
    const match = this.source.slice(this.index).match(
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    )
    if (!match) this.syntaxError()
    this.index += match[0].length
  }

  private skipWhitespace() {
    while (
      this.source[this.index] === ' '
      || this.source[this.index] === '\n'
      || this.source[this.index] === '\r'
      || this.source[this.index] === '\t'
    ) {
      this.index += 1
    }
  }

  private syntaxError(): never {
    throw new StrictJsonError('Malformed JSON', 'syntax')
  }
}

export function parseStrictJson(source: string): StrictJsonParseResult {
  return new StrictJsonScanner(source).parse()
}
