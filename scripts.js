const backendUrl = "http://127.0.0.1:8000";

async function uploadPDF() {
  const fileInput = document.getElementById("pdf-upload");
  const uploadStatus = document.getElementById("upload-status");
  if (!fileInput.files.length) {
    uploadStatus.innerText = "Please select a PDF file.";
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  uploadStatus.innerText = "Uploading...";
  try {
    const response = await fetch(`${backendUrl}/upload-pdf`, {
      method: "POST",
      body: formData
    });
    const result = await response.json();
    if (response.ok) {
      uploadStatus.innerText = "PDF uploaded and processed successfully!";
    } else {
      uploadStatus.innerText = `Error: ${result.detail}`;
    }
  } catch (error) {
    uploadStatus.innerText = "An error occurred during upload.";
  }
}

async function clearPDFs() {
  const clearStatus = document.getElementById("clear-status");
  clearStatus.innerText = "Clearing PDFs...";
  try {
    const response = await fetch(`${backendUrl}/clear-pdfs`, {
      method: "POST"
    });
    const result = await response.json();
    if (response.ok) {
      clearStatus.innerText = result.message;
    } else {
      clearStatus.innerText = `Error: ${result.detail}`;
    }
  } catch (error) {
    clearStatus.innerText = "An error occurred while clearing PDFs.";
  }
}

async function askQuestion() {
  const queryInput = document.getElementById("query");
  const chatHistory = document.getElementById("chat-history");
  const question = queryInput.value.trim();

  if (!question) {
    alert("Please enter a question.");
    return;
  }

  // Display the user's question
  const userMessage = document.createElement("div");
  userMessage.classList.add("message", "user-message");
  userMessage.innerText = `You: ${question}`;
  chatHistory.appendChild(userMessage);

  try {
    const response = await fetch(`${backendUrl}/ask-question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });
    const result = await response.json();

    // Display the AI's response
    const aiMessage = document.createElement("div");
    aiMessage.classList.add("message", "ai-message");
    aiMessage.innerText = `AI: ${result.response || "No response available."}`;
    chatHistory.appendChild(aiMessage);

    // Display context (where the information was found)
    const contextMessage = document.createElement("div");
    contextMessage.classList.add("message", "context");
    contextMessage.innerHTML = `Context: <br>${result.context || "No context available."}`;
    chatHistory.appendChild(contextMessage);

  } catch (error) {
    const errorMessage = document.createElement("div");
    errorMessage.classList.add("message", "ai-message");
    errorMessage.innerText = "Error: Unable to get a response.";
    chatHistory.appendChild(errorMessage);
  }

  chatHistory.scrollTop = chatHistory.scrollHeight; // Scroll to bottom
}
