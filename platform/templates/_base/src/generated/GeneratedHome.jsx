// Fallback safe: quando il codegen frontend e' disabilitato (o non ha
// prodotto un override), `/` mostra la HomePage premium scritta a mano.
// Il codegen, se attivo, sovrascrive questo file con la versione AI.
import "./generated.css";
import HomePage from "../pages/HomePage.jsx";

export default function GeneratedHome() {
  return <HomePage />;
}
