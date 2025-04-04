// Initialize Stripe
const stripe = Stripe('your_stripe_publishable_key_here'); // Replace with your publishable key

// Create payment form
function createPaymentForm(containerId, amount) {
    const container = document.getElementById(containerId);
    
    const form = document.createElement('form');
    form.id = 'payment-form';
    
    const paymentElement = document.createElement('div');
    paymentElement.id = 'payment-element';
    
    const submitButton = document.createElement('button');
    submitButton.id = 'submit';
    submitButton.textContent = 'Pay now';
    
    form.appendChild(paymentElement);
    form.appendChild(submitButton);
    container.appendChild(form);
    
    // Handle form submission
    form.addEventListener('submit', handleSubmit);
    
    // Initialize payment element
    initializePaymentElement(amount);
}

// Initialize payment element
async function initializePaymentElement(amount) {
    try {
        const response = await fetch('/api/stripe/create-payment-intent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ amount }),
        });
        
        const { clientSecret } = await response.json();
        
        const elements = stripe.elements({
            clientSecret,
            appearance: {
                theme: 'stripe',
            },
        });
        
        const paymentElement = elements.create('payment');
        paymentElement.mount('#payment-element');
    } catch (error) {
        console.error('Error initializing payment:', error);
    }
}

// Handle form submission
async function handleSubmit(e) {
    e.preventDefault();
    
    const submitButton = document.getElementById('submit');
    submitButton.disabled = true;
    submitButton.textContent = 'Processing...';
    
    try {
        const { error } = await stripe.confirmPayment({
            elements,
            confirmParams: {
                return_url: `${window.location.origin}/payment-complete.html`,
            },
        });
        
        if (error) {
            const messageContainer = document.getElementById('error-message');
            messageContainer.textContent = error.message;
            submitButton.disabled = false;
            submitButton.textContent = 'Pay now';
        }
    } catch (error) {
        console.error('Error processing payment:', error);
        submitButton.disabled = false;
        submitButton.textContent = 'Pay now';
    }
}

// Export functions for use in other files
window.createPaymentForm = createPaymentForm; 