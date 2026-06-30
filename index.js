document.getElementById("user-input").value = ""; // Limpa a entrada
});

function displayMessage(message, sender) {
    let messagesDiv = document.getElementById("messages");
    let messageDiv = document.createElement("div");
    messageDiv.classList.add(sender);
    messageDiv.textContent = message;
    messagesDiv.appendChild(messageDiv);
}

// Exemplo de função para lidar com a mensagem do usuário
function handleUserMessage(message) {
    const botResponse = "Esta é uma resposta do VagasBot."; // Lógica de resposta a ser implementada
    displayMessage(botResponse, "bot");
}
```
