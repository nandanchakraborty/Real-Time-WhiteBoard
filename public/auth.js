const form = document.getElementById('auth-form');
const tabs = document.querySelectorAll('.tab');
const nameField = document.getElementById('name');
const formTitle = document.getElementById('form-title');
const formDescription = document.getElementById('form-description');
const formMessage = document.getElementById('form-message');
const submitButton = document.getElementById('submit-button');

let mode = 'login';
const API_BASE_URL = (window.WHITEBOARD_API_URL || '').replace(/\/$/, '');

function apiUrl(path) {
	return `${API_BASE_URL}${path}`;
}

function setMode(nextMode) {
	mode = nextMode;
	const isRegistering = mode === 'register';

	nameField.classList.toggle('is-hidden', !isRegistering);
	nameField.previousElementSibling.classList.toggle('is-hidden', !isRegistering);
	nameField.required = isRegistering;
	nameField.autocomplete = isRegistering ? 'name' : 'off';
	document.getElementById('password').autocomplete = isRegistering ? 'new-password' : 'current-password';
	formTitle.textContent = isRegistering ? 'Create your account' : 'Log in to your board';
	formDescription.textContent = isRegistering ? 'A few details, then you are ready to collaborate.' : 'Use your account details to continue.';
	submitButton.innerHTML = `${isRegistering ? 'Create account' : 'Log in'} <span aria-hidden="true">&rarr;</span>`;
	formMessage.textContent = '';
	formMessage.className = 'form-message';

	tabs.forEach((tab) => {
		const isActive = tab.dataset.mode === mode;
		tab.classList.toggle('is-active', isActive);
		tab.setAttribute('aria-selected', String(isActive));
	});
}

tabs.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

form.addEventListener('submit', async (event) => {
	event.preventDefault();
	formMessage.textContent = '';
	formMessage.className = 'form-message';
	submitButton.disabled = true;

	const formData = new FormData(form);
	const body = Object.fromEntries(formData.entries());
	const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';

	try {
		const response = await fetch(apiUrl(endpoint), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify(body)
		});
		const result = await response.json();

		if (!response.ok) {
			throw new Error(result.error || 'Something went wrong');
		}

		localStorage.setItem('whiteboardAccessToken', result.accessToken);
		localStorage.setItem('whiteboardUser', JSON.stringify(result.user));
		formMessage.textContent = mode === 'register' ? 'Account created. You can now log in.' : 'Logged in. Opening the whiteboard...';
		formMessage.classList.add('success');

		if (mode === 'register') {
			form.reset();
			setMode('login');
			formMessage.textContent = 'Account created. You can now log in.';
			formMessage.classList.add('success');
		} else {
			window.setTimeout(() => { window.location.href = '/whiteboard'; }, 500);
		}
	} catch (error) {
		formMessage.textContent = error.message;
	} finally {
		submitButton.disabled = false;
	}
});
