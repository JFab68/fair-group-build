/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./*.html', './src/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        navy: '#000080',
        maroon: '#800000',
        'dark-gray': '#333333',
        'light-gray': '#F5F5F5',
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'serif'],
        body: ['Poppins', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
