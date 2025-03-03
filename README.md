# AI Code Insight README

## Features

Use AI to review the code of opened files and give suggestions

## How to use

1. Once the plugin is installed, please configure the OpenAI API Key in the settings. You can get your API key from [OpenAI](https://platform.openai.com/account/api-keys).
2. Open a file in the editor.
3. Right-click on the editor and select "AI Code Insight: Review Code" to get AI suggestions for the opened file.

## Extension Settings

This extension contributes the following settings:

* `aiCodeInsight.apiKey`: OpenAI API Key for AI Code Insight.
* `aiCodeInsight.model`: The model of OpenAI to use for AI Code Insight. Defaults to `gpt-4-1106-preview`.
* `aiCodeInsight.maxLines`:The maximum number of lines of code that can be analyzed. Determined by the number of tokens that the model can handle. Defaults to `200`.
* `aiCodeInsight.maxReviews`: The maximum number of review suggestions that can be returned. Defaults to `10`.