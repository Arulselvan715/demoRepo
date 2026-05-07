function addProduct(){

    let name = document.getElementById("name").value;
    let quantity = document.getElementById("quantity").value;
    let price = document.getElementById("price").value;

    let table = document.getElementById("productTable");

    let row = table.insertRow();

    row.insertCell(0).innerHTML = name;
    row.insertCell(1).innerHTML = quantity;
    row.insertCell(2).innerHTML = price;

    if(quantity < 10){
        alert("Low Stock Alert!");
    }
}