import * as vscode from 'vscode'
import OpenAI from 'openai'

async function getApiKey(): Promise<string | undefined> {
	const config = vscode.workspace.getConfiguration('aiCodeInsight')
	const apiKey = config.get<string>('apiKey')

	if (!apiKey) {
		vscode.window.showErrorMessage('Please configure OpenAI API Key in VS Code settings')
		return undefined
	}
	return apiKey
}

async function getModel(): Promise<string> {
	const config = vscode.workspace.getConfiguration('aiCodeReview')
	return config.get<string>('model') || 'gpt-4-1106-preview'
}

function getLanguageFromFileName(fileName: string) {
	const ext = fileName.split('.').pop()
	const mapping: { [x: string]: string } = {
		js: 'javascript',
		jsx: 'javascriptreact',
		ts: 'typescript',
		tsx: 'typescriptreact',
		py: 'python',
		java: 'java',
		cpp: 'cpp',
		cs: 'csharp',
		go: 'go',
		rb: 'ruby',
		php: 'php',
		swift: 'swift',
		kt: 'kotlin'
	}
	return ext ? mapping[ext] : 'plaintext'
}

function createPrompt(fileName: string, code: string) {
	const fileContent = code.split("\n").map((line, index) => `${index + 1}: ${line}`).join("\n")
	return `Your task is to review the following code and provide constructive feedback. Instructions:
- Provide the response in the following JSON format: {"reviews": [{"lineNumber": <line_number>, "reviewComment": "<review comment>"}]}
- The \"lineNumber\" should exactly match the line numbers shown in the provided code.
- Do not give positive comments or compliments.
- Provide comments and suggestions ONLY if there is something to improve, otherwise "reviews" should be an empty array.
- Write the comment in GitHub Markdown format.
- Focus only on code quality, best practices, potential bugs, performance, and readability.
- IMPORTANT: NEVER suggest adding comments to the code.

Review the following code in the file **"${fileName}"** and provide feedback accordingly:

\`\`\`${getLanguageFromFileName(fileName)}
${fileContent}
\`\`\`
`
}

async function getAIResponse(openai: OpenAI, model: string, prompt: string) {
	const queryConfig = {
		model,
		temperature: 0.2,
		max_tokens: 700,
		top_p: 1,
		frequency_penalty: 0,
		presence_penalty: 0,
	}

	try {
		const response = await openai.chat.completions.create({
			...queryConfig,
			// return JSON if the model supports it:
			...(model === "gpt-4-1106-preview"
				? { response_format: { type: "json_object" } }
				: {}),
			messages: [
				{
					role: "system",
					content: prompt,
				},
			],
		})

		const res = response.choices[0].message?.content?.trim() || "{}"
		return JSON.parse(res).reviews
	} catch (error: any) {
		vscode.window.showErrorMessage(`CodeInsight: Code review failed: ${error}`)
		return null
	}
}

const diagnostics = vscode.languages.createDiagnosticCollection('aiCodeInsight')
const hiddenDiagnostics = new Set<string>()

async function reviewCode() {
	const apiKey = await getApiKey()
	if (!apiKey) {
		return
	}
	const model = await getModel()

	const editor = vscode.window.activeTextEditor
	if (!editor) {
		vscode.window.showWarningMessage('Please open a code file')
		return
	}
	const { languageId } = editor.document
	if (!['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(languageId)) {
		vscode.window.showWarningMessage(`AI Review is not supported for ${languageId} files.`)
		return
	}

	const fileName = editor.document.fileName
	const code = editor.document.getText()
	const prompt = createPrompt(fileName, code)
	vscode.window.showInformationMessage('Analyzing code, please wait...')

	try {
		const openai = new OpenAI({ apiKey })
		const reviews = await getAIResponse(openai, model, prompt)
		if (!reviews) {
			return
		}
		const uri = editor.document.uri
		diagnostics.clear()
		const issues: vscode.Diagnostic[] = []

		reviews.forEach((review: { lineNumber: number, reviewComment: string }) => {
			let line = review.lineNumber - 1
			if (line < 0 || line >= editor.document.lineCount) {
				line = 0
			}
			const range = new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length)
			const key = `${uri.toString()}:${line}`
			if (hiddenDiagnostics.has(key)) {
				return
			}
			const diagnostic = new vscode.Diagnostic(range, review.reviewComment, vscode.DiagnosticSeverity.Warning)
			diagnostic.code = key
			issues.push(diagnostic)
		})

		diagnostics.set(uri, issues)
		vscode.window.showInformationMessage('CodeInsight: Code review completed with AI suggestions')
	} catch (error) {
		vscode.window.showErrorMessage(`CodeInsight: Code review failed: ${error}`)
	}
}

function clearDiagnostics() {
	diagnostics.clear()
	hiddenDiagnostics.clear()
}

class HideDiagnosticQuickFix implements vscode.CodeActionProvider {
	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range,
		context: vscode.CodeActionContext
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = []
		const uri = document.uri
		const seenCodes = new Set<string>()

		for (const diagnostic of context.diagnostics) {
			if (typeof diagnostic.code === 'string' && !hiddenDiagnostics.has(diagnostic.code)) {
				if (!seenCodes.has(diagnostic.code)) {
					const hideSingleAction = new vscode.CodeAction(
						'Hide review warning',
						vscode.CodeActionKind.QuickFix
					)

					hideSingleAction.command = {
						title: 'Hide this warning',
						command: 'aiCodeInsight.hideDiagnostic',
						arguments: [uri, diagnostic.code]
					}

					actions.push(hideSingleAction)
					seenCodes.add(diagnostic.code)
				}
			}
		}

		return actions
	}
}

function hideDiagnostic(uri: vscode.Uri, diagnosticCode: string) {
	if (!uri) { return }
	const currentDiagnostics = diagnostics.get(uri) || []

	const updatedDiagnostics = currentDiagnostics.filter(d => d.code !== diagnosticCode)
	hiddenDiagnostics.add(diagnosticCode)

	diagnostics.delete(uri)
	if (updatedDiagnostics.length > 0) {
		diagnostics.set(uri, updatedDiagnostics)
	}
}

function hideAllDiagnostics(uri: vscode.Uri) {
	if (!uri) { return }

	const currentDiagnostics = diagnostics.get(uri) || []
	let hasUpdates = false

	currentDiagnostics.forEach(diagnostic => {
		if (typeof diagnostic.code === 'string' && !hiddenDiagnostics.has(diagnostic.code)) {
			hiddenDiagnostics.add(diagnostic.code)
			hasUpdates = true
		}
	})

	if (hasUpdates) {
		diagnostics.delete(uri)
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('aiCodeInsight.reviewCode', reviewCode),
		vscode.commands.registerCommand('aiCodeInsight.clearDiagnostics', clearDiagnostics),
		vscode.commands.registerCommand('aiCodeInsight.hideDiagnostic', hideDiagnostic),
		vscode.commands.registerCommand('aiCodeInsight.hideAllDiagnostics', hideAllDiagnostics),
		vscode.languages.registerCodeActionsProvider(
			[
				{ scheme: 'file', language: 'javascript' },
				{ scheme: 'file', language: 'javascriptreact' },
				{ scheme: 'file', language: 'typescript' },
				{ scheme: 'file', language: 'typescriptreact' }
			],
			new HideDiagnosticQuickFix(),
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
		)
	)
}

export function deactivate() { }
