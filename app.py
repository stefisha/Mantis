from fastapi import FastAPI, File, UploadFile, HTTPException
from pydantic import BaseModel
import os
import pdfplumber
import tempfile
import logging
from langchain_openai.embeddings import OpenAIEmbeddings
from langchain_chroma.vectorstores import Chroma
from langchain_openai.chat_models import ChatOpenAI
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.prompts import PromptTemplate
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv  # Import the dotenv package

# Load environment variables from .env file
load_dotenv()

# Configure Logging
logger = logging.getLogger("PDF_RAG")
logger.setLevel(logging.INFO)

if logger.hasHandlers():
    logger.handlers.clear()

console_handler = logging.StreamHandler()
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)

# Set OpenAI API key from the .env file
openai_api_key = os.getenv("OPENAI_API_KEY")
if openai_api_key:
    logger.info("OpenAI API Key loaded successfully.")
else:
    logger.error("Failed to load OpenAI API Key.")

# FastAPI App Initialization
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Replace "*" with specific origins (e.g., ["http://127.0.0.1:5500"]) in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize global vector store
vector_store = None

# Extract text from PDF with page numbers and paragraphs
def extract_text_from_pdf(pdf_path):
    logger.info(f"Starting text extraction from: {pdf_path}")
    try:
        with pdfplumber.open(pdf_path) as pdf:
            chunks = []
            for page_number, page in enumerate(pdf.pages, start=1):
                text = page.extract_text()
                if text:
                    paragraphs = text.split("\n")  # Split by new line for paragraphs
                    for paragraph in paragraphs:
                        if paragraph.strip():  # Only add non-empty paragraphs
                            chunks.append({"text": paragraph, "page": page_number})
        logger.info("Text extraction completed.")
        return chunks
    except Exception as e:
        logger.error(f"Error during text extraction: {e}")
        raise HTTPException(status_code=500, detail=f"Error during text extraction: {e}")

# Embed text
def embed_text(chunks, embedding_model):
    logger.info("Starting text embedding.")
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    texts, metadata = [], []
    for chunk in chunks:
        split_texts = text_splitter.split_text(chunk["text"])
        texts.extend(split_texts)
        metadata.extend([{"page": chunk["page"], "paragraph": chunk["text"]} for _ in split_texts])
    embeddings = embedding_model.embed_documents(texts)
    logger.info("Text embedding completed.")
    return texts, embeddings, metadata

# Store embeddings
def store_embeddings(texts, metadata, embedding_model, persist_directory="chroma_db"):
    logger.info("Storing embeddings in Chroma.")
    vector_store = Chroma.from_texts(
        texts=texts,
        embedding=embedding_model,
        persist_directory=persist_directory,
        metadatas=metadata  # Pass metadata
    )
    logger.info("Embeddings stored in Chroma.")
    return vector_store

@app.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    global vector_store
    try:
        # Save uploaded file to a temporary location
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            temp_file.write(await file.read())
            temp_file_path = temp_file.name

        # Step 1: Extract text from PDF
        chunks = extract_text_from_pdf(temp_file_path)

        # Step 2: Embed text
        embedding_model = OpenAIEmbeddings()
        texts, embeddings, metadata = embed_text(chunks, embedding_model)

        # Step 3: Store embeddings in Chroma
        vector_store = store_embeddings(texts, metadata, embedding_model)

        # Cleanup temporary file
        os.remove(temp_file_path)

        response = {"success": True, "message": "PDF processed successfully.", "chunks": len(texts)}
        logger.info(f"Response: {response}")
        return response
    except Exception as e:
        logger.error(f"Error processing PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {e}")


@app.post("/clear-pdfs")
async def clear_pdfs():
    global vector_store
    vector_store = None
    return {"message": "PDFs cleared from memory successfully."}

# Model for the ask-question endpoint
class QueryRequest(BaseModel):
    question: str

@app.post("/ask-question")
async def ask_question(request: QueryRequest):
    global vector_store
    if not vector_store:
        raise HTTPException(status_code=400, detail="No PDF has been processed yet.")
    try:
        chat_model = ChatOpenAI(model_name="gpt-4", temperature=0)

        # Retrieve relevant documents
        retriever = vector_store.as_retriever()
        relevant_docs = retriever.invoke(request.question)  # Use invoke instead of get_relevant_documents()

        if not relevant_docs:
            raise HTTPException(status_code=404, detail="No relevant context found.")

        # Log the metadata to verify it
        for doc in relevant_docs:
            logger.info(f"Document metadata: {doc.metadata}")

        # Build context by including content with page and paragraph info
        context = ""
        for doc in relevant_docs:
            page = doc.metadata.get('page', 'Unknown Page')  # Safely access 'page' metadata
            paragraph = doc.metadata.get('paragraph', 'Unknown Paragraph')  # Safely access 'paragraph' metadata
            context += f"Page {page} (Paragraph): {doc.page_content}\n"

        logger.info(f"Retrieved context: {context}")

        # Format the prompt with the context and query
        prompt = PromptTemplate(
            input_variables=["context", "query"],
            template=( 
                "Use the following context extracted from the PDF to answer the query. "
                "Be specific and refer to the page numbers and paragraphs when relevant:\n\n"
                "Context:\n{context}\n\nQuery:\n{query}"
            )
        )
        formatted_prompt = prompt.format(context=context, query=request.question)
        response = chat_model.predict(formatted_prompt)

        return {
            "success": True,
            "response": response,
            "context": context,  # Optional: Include the context for debugging or frontend use
        }
    except Exception as e:
        logger.error(f"Error processing question: {e}")
        raise HTTPException(status_code=500, detail="Error processing question.")
