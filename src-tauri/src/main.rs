#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{env, path::PathBuf};
use tauri::ipc::Response;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    message: Option<OllamaMessage>,
}

#[derive(Debug, Deserialize)]
struct OllamaMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    choices: Option<Vec<OpenAiChoice>>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: Option<OpenAiMessage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
}

#[tauri::command]
async fn invoke_llm(
    messages: Vec<ChatMessage>,
    response_format: Option<String>,
    temperature: Option<f64>,
) -> Result<String, String> {
    load_project_env();

    let endpoint = env::var("TAURI_LLM_ENDPOINT").unwrap_or_else(|_| "http://localhost:11434".to_string());
    let model = env::var("TAURI_LLM_MODEL").unwrap_or_else(|_| "qwen2.5:7b".to_string());
    let api_key = env::var("TAURI_LLM_API_KEY").ok().filter(|value| !value.trim().is_empty());
    let client = reqwest::Client::new();

    if is_openai_compatible(&endpoint) {
        call_openai_compatible(&client, &endpoint, api_key.as_deref(), &model, messages, response_format, temperature).await
    } else {
        call_ollama(&client, &endpoint, &model, messages, temperature).await
    }
}

#[tauri::command]
async fn read_local_file(path: String) -> Result<Response, String> {
    let path_buf = PathBuf::from(&path);
    let file_name = path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "INVALID_FILE_NAME".to_string())?;

    if !is_supported_gis_file(file_name) {
        return Err("UNSUPPORTED_FILE_TYPE".to_string());
    }

    let bytes = std::fs::read(&path_buf)
        .map_err(|error| format!("FILE_READ_FAILED: {error}"))?;

    Ok(Response::new(bytes))
}

fn load_project_env() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(project_root) = manifest_dir.parent() {
        let _ = dotenvy::from_path(project_root.join(".env"));
    }
}

fn is_openai_compatible(endpoint: &str) -> bool {
    let lower = endpoint.to_lowercase();
    lower.contains("api.openai.com")
        || lower.contains("deepseek")
        || lower.contains("openai.com")
        || lower.contains("modelscope")
        || lower.contains("siliconflow")
        || lower.contains("v1/chat/completions")
}

fn openai_url(endpoint: &str) -> String {
    let trimmed = endpoint.trim_end_matches('/');
    if trimmed.to_lowercase().contains("/v1/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/v1/chat/completions")
    }
}

fn ollama_url(endpoint: &str) -> String {
    let trimmed = endpoint.trim_end_matches('/');
    if trimmed.to_lowercase().ends_with("/api/chat") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/api/chat")
    }
}

async fn call_openai_compatible(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: Option<&str>,
    model: &str,
    messages: Vec<ChatMessage>,
    response_format: Option<String>,
    temperature: Option<f64>,
) -> Result<String, String> {
    let mut request = client
        .post(openai_url(endpoint))
        .header("Content-Type", "application/json");

    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }

    let mut body = json!({
        "model": model,
        "messages": messages,
        "temperature": temperature.unwrap_or(0.1),
        "stream": false,
    });

    if matches!(response_format.as_deref(), Some("json")) {
        body["response_format"] = json!({ "type": "json_object" });
    }

    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("OPENAI_REQUEST_FAILED: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OPENAI_API_ERROR {status}: {text}"));
    }

    let data = response
        .json::<OpenAiResponse>()
        .await
        .map_err(|error| format!("OPENAI_RESPONSE_PARSE_FAILED: {error}"))?;

    Ok(data
        .choices
        .and_then(|choices| choices.into_iter().next())
        .and_then(|choice| choice.message)
        .and_then(|message| message.content)
        .unwrap_or_default())
}

async fn call_ollama(
    client: &reqwest::Client,
    endpoint: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
) -> Result<String, String> {
    let response = client
        .post(ollama_url(endpoint))
        .header("Content-Type", "application/json")
        .json(&json!({
            "model": model,
            "messages": messages,
            "stream": false,
            "format": "json",
            "options": { "temperature": temperature.unwrap_or(0.1) },
        }))
        .send()
        .await
        .map_err(|error| format!("OLLAMA_REQUEST_FAILED: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OLLAMA_API_ERROR {status}: {text}"));
    }

    let data = response
        .json::<OllamaResponse>()
        .await
        .map_err(|error| format!("OLLAMA_RESPONSE_PARSE_FAILED: {error}"))?;

    Ok(data.message.and_then(|message| message.content).unwrap_or_default())
}

fn is_supported_gis_file(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    lower.ends_with(".geojson") || lower.ends_with(".json") || lower.ends_with(".zip") || lower.ends_with(".shp")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![invoke_llm, read_local_file])
        .run(tauri::generate_context!())
        .expect("error while running GeoSurgical WebGIS desktop app");
}
