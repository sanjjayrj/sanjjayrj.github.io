function toggleMenu() {
    const nav = document.querySelector('header nav');
    const hamburger = document.querySelector('.hamburger');
    nav.classList.toggle('active'); // Show or hide the menu
    hamburger.classList.toggle('active'); // Animate the hamburger icon
}