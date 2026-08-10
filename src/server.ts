import express from "express";

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "ReadyEcommerce API is running",
  });
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
