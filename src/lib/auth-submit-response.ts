/** Readable failure copy at the classic anonymous auth submit boundaries only. */
export async function fetchAuthSubmit(url: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options)
  } catch (error) {
    // Browser fetch transport failures are TypeErrors; aborts retain their identity.
    if (error instanceof TypeError) {
      throw new Error('Unable to connect. Check your connection and try again.')
    }
    throw error
  }
}

export async function readAuthSubmitResponse(response: Response) {
  try {
    return await response.json()
  } catch (error) {
    // JSON syntax failures must not expose parser internals in a field alert.
    if (error instanceof SyntaxError) {
      throw new Error('Unable to read the response. Please try again.')
    }
    throw error
  }
}
